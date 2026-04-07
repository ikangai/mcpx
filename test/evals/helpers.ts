/**
 * Eval test helpers — spawn mcpx as a child process and assert on
 * structured JSON envelope output + exit codes.
 *
 * These helpers target the NEW invocation model:
 *   mcpx /server tool --params '{"key": "value"}'
 *
 * Exit codes follow the gws-inspired contract:
 *   0 = success, 1 = tool error, 2 = connection error,
 *   3 = validation error, 4 = config error, 5 = internal error
 */

import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MCPX_BIN = resolve(__dirname, "../../src/index.ts");
const TSX = "npx";

export interface McpxResult {
  /** Process exit code */
  exitCode: number;
  /** Raw stdout string */
  stdout: string;
  /** Raw stderr string */
  stderr: string;
  /** Parsed JSON envelope from stdout (null if stdout isn't valid JSON) */
  json: Envelope | null;
}

/** The structured JSON envelope every mcpx command should return */
export interface Envelope {
  ok: boolean;
  result?: ContentItem[];
  error?: { code: number; message: string };
  tools?: ToolInfo[];
  schema?: Record<string, unknown>;
  servers?: Array<{ alias: string; command: string; args: string[]; env?: Record<string, string> }>;
}

export interface ContentItem {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Run mcpx with the given arguments and return structured output.
 * Uses tsx to run TypeScript source directly.
 */
export async function runMcpx(
  args: string[],
  options: { timeout?: number; env?: Record<string, string>; configDir?: string } = {}
): Promise<McpxResult> {
  const { timeout = 30_000, env = {}, configDir } = options;

  const finalEnv: Record<string, string> = {
    ...process.env as Record<string, string>,
    ...env,
    // Force JSON output for agent-facing evals (no TTY detection)
    FORCE_COLOR: "0",
    NODE_NO_WARNINGS: "1",
  };

  if (configDir) {
    finalEnv.MCPX_CONFIG_DIR = configDir;
  }

  return new Promise<McpxResult>((resolve, reject) => {
    const child = spawn(TSX, ["tsx", MCPX_BIN, ...args], {
      env: finalEnv,
      stdio: ["pipe", "pipe", "pipe"],
      timeout,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);

    child.on("close", (code) => {
      const trimmedStdout = stdout.trim();
      let json: Envelope | null = null;

      try {
        json = JSON.parse(trimmedStdout) as Envelope;
      } catch {
        // stdout wasn't valid JSON — that's fine, json stays null
      }

      resolve({
        exitCode: code ?? 1,
        stdout: trimmedStdout,
        stderr: stderr.trim(),
        json,
      });
    });

    // Close stdin immediately — mcpx shouldn't need interactive input
    child.stdin.end();
  });
}

/**
 * Creates an isolated temporary config directory for eval tests.
 * Returns the path and a cleanup function.
 */
export function createTempConfigDir(): { dir: string; cleanup: () => void } {
  const dir = join(tmpdir(), `mcpx-eval-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });

  return {
    dir,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    },
  };
}

/**
 * Write a servers config file into the given config directory.
 * Matches the Claude Desktop mcpServers format.
 */
export function writeServersConfig(
  configDir: string,
  servers: Record<string, { command: string; args?: string[] }>
): string {
  const configPath = join(configDir, "servers.json");
  const config = { mcpServers: servers };
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  return configPath;
}

/**
 * Read a servers config file from the given config directory.
 */
export function readServersConfig(
  configDir: string
): Record<string, { command: string; args?: string[] }> | null {
  const configPath = join(configDir, "servers.json");
  if (!existsSync(configPath)) return null;
  const raw = readFileSync(configPath, "utf-8");
  const config = JSON.parse(raw);
  return config.mcpServers ?? null;
}

/** The test server command for use in evals */
export const TEST_SERVER_CMD = {
  command: "npx",
  args: ["tsx", resolve(__dirname, "../integration/test-server.ts")],
};

/** Shorthand for the test server as an inline -s argument */
export const TEST_SERVER_INLINE = `npx tsx ${resolve(__dirname, "../integration/test-server.ts")}`;

/**
 * Assert that a result matches the success envelope shape.
 */
export function expectSuccess(result: McpxResult): asserts result is McpxResult & { json: Envelope & { ok: true } } {
  if (result.exitCode !== 0) {
    throw new Error(
      `Expected exit code 0, got ${result.exitCode}.\nstderr: ${result.stderr}\nstdout: ${result.stdout}`
    );
  }
  if (!result.json) {
    throw new Error(`Expected JSON output, got: ${result.stdout}`);
  }
  if (!result.json.ok) {
    throw new Error(`Expected ok: true, got: ${JSON.stringify(result.json)}`);
  }
}

/**
 * Assert that a result matches the error envelope shape with a specific exit code.
 */
export function expectError(result: McpxResult, expectedExitCode: number): asserts result is McpxResult & { json: Envelope & { ok: false } } {
  if (result.exitCode !== expectedExitCode) {
    throw new Error(
      `Expected exit code ${expectedExitCode}, got ${result.exitCode}.\nstderr: ${result.stderr}\nstdout: ${result.stdout}`
    );
  }
  if (!result.json) {
    throw new Error(`Expected JSON error output, got: ${result.stdout}`);
  }
  if (result.json.ok !== false) {
    throw new Error(`Expected ok: false, got: ${JSON.stringify(result.json)}`);
  }
}
