import { describe, it, expect, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createTempConfigDir, writeServersConfig, TEST_SERVER_CMD } from "./helpers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MCPX_BIN = resolve(__dirname, "../../src/index.ts");

function runBatchWithStdin(
  args: string[],
  stdin: string,
  opts: { configDir: string; timeout?: number }
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", MCPX_BIN, ...args], {
      env: {
        ...process.env,
        MCPX_CONFIG_DIR: opts.configDir,
        FORCE_COLOR: "0",
        NODE_NO_WARNINGS: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
      timeout: opts.timeout ?? 30_000,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() });
    });

    child.stdin.write(stdin);
    child.stdin.end();
  });
}

describe("batch --parallel", () => {
  const { dir, cleanup } = createTempConfigDir();
  writeServersConfig(dir, { test: TEST_SERVER_CMD });

  it("executes multiple tool calls concurrently", async () => {
    const ndjsonInput = [
      '{"tool":"greet","params":{"name":"Alice"}}',
      '{"tool":"greet","params":{"name":"Bob"}}',
      '{"tool":"add","params":{"a":1,"b":2}}',
    ].join("\n");

    const result = await runBatchWithStdin(
      ["batch", "/test", "--parallel", "2"],
      ndjsonInput,
      { configDir: dir, timeout: 30_000 }
    );

    // Should get 3 NDJSON lines back
    const lines = result.stdout.split("\n").filter(Boolean);
    expect(lines.length).toBe(3);

    // All should be valid JSON envelopes with ok: true
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed.ok).toBe(true);
    }
  }, 30_000);

  it("preserves order in parallel mode", async () => {
    const ndjsonInput = [
      '{"tool":"greet","params":{"name":"First"}}',
      '{"tool":"greet","params":{"name":"Second"}}',
    ].join("\n");

    const result = await runBatchWithStdin(
      ["batch", "/test", "--parallel", "2"],
      ndjsonInput,
      { configDir: dir, timeout: 30_000 }
    );

    const lines = result.stdout.split("\n").filter(Boolean);
    expect(lines.length).toBe(2);

    const first = JSON.parse(lines[0]);
    const second = JSON.parse(lines[1]);
    expect(JSON.stringify(first)).toContain("First");
    expect(JSON.stringify(second)).toContain("Second");
  }, 30_000);

  afterAll(() => cleanup());
});
