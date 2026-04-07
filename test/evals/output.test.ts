/**
 * Category 4: Output Contract Evals
 *
 * Every mcpx response must be structured JSON with a consistent envelope.
 * This is the #1 requirement for agent consumers — predictable shape,
 * parseable by jq, no TTY escape codes in piped output.
 *
 * Envelope: {"ok": bool, "result": [...], "error": {...}}
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  runMcpx,
  createTempConfigDir,
  expectSuccess,
  expectError,
  TEST_SERVER_INLINE,
  type Envelope,
} from "./helpers.js";

describe("output contract", () => {
  let configDir: string;
  let cleanup: () => void;

  beforeAll(async () => {
    ({ dir: configDir, cleanup } = createTempConfigDir());
    await runMcpx(["add", "test", TEST_SERVER_INLINE], { configDir });
  }, 15_000);

  afterAll(() => {
    cleanup();
  });

  // --- success envelope ---

  it("wraps successful results in {ok: true, result: [...]} envelope", async () => {
    const result = await runMcpx(
      ["/test", "greet", "--params", '{"name": "Agent"}'],
      { configDir }
    );

    expectSuccess(result);

    // Verify exact envelope shape
    const json = result.json!;
    expect(json).toHaveProperty("ok", true);
    expect(json).toHaveProperty("result");
    expect(Array.isArray(json.result)).toBe(true);
    expect(json).not.toHaveProperty("error");
  }, 30_000);

  // --- error envelope ---

  it("wraps errors in {ok: false, error: {code, message}} envelope", async () => {
    const result = await runMcpx(
      ["/test", "nonexistent", "--params", "{}"],
      { configDir }
    );

    expectError(result, 3);

    const json = result.json!;
    expect(json).toHaveProperty("ok", false);
    expect(json).toHaveProperty("error");
    expect(json.error).toHaveProperty("code");
    expect(json.error).toHaveProperty("message");
    expect(typeof json.error!.code).toBe("number");
    expect(typeof json.error!.message).toBe("string");
  }, 30_000);

  it("wraps tool errors (isError) in error envelope with exit 1", async () => {
    const result = await runMcpx(
      ["/test", "fail", "--params", "{}"],
      { configDir }
    );

    expectError(result, 1);

    const json = result.json!;
    expect(json.ok).toBe(false);
    expect(json.error!.code).toBe(1);
    expect(json.error!.message.length).toBeGreaterThan(0);
  }, 30_000);

  // --- content types ---

  it("preserves text content items in result array", async () => {
    const result = await runMcpx(
      ["/test", "greet", "--params", '{"name": "Test"}'],
      { configDir }
    );

    expectSuccess(result);

    const item = result.json.result![0];
    expect(item.type).toBe("text");
    expect(typeof item.text).toBe("string");
  }, 30_000);

  it("preserves multiple content items in result array", async () => {
    const result = await runMcpx(
      ["/test", "multi-content", "--params", "{}"],
      { configDir }
    );

    expectSuccess(result);
    expect(result.json.result!.length).toBe(3);
    expect(result.json.result![0].text).toBe("First item");
    expect(result.json.result![1].text).toBe("Second item");

    // Third item is JSON text — should be preserved as-is, not parsed
    const third = result.json.result![2];
    expect(third.type).toBe("text");
    expect(JSON.parse(third.text!)).toEqual({ third: true });
  }, 30_000);

  // --- pipe-friendly output ---

  it("outputs valid JSON with no ANSI escape codes", async () => {
    const result = await runMcpx(
      ["/test", "greet", "--params", '{"name": "World"}'],
      { configDir }
    );

    // No ANSI escape sequences in stdout
    expect(result.stdout).not.toMatch(/\x1b\[/);

    // Must be valid JSON
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  }, 30_000);

  it("outputs one JSON object (not NDJSON) for single invocations", async () => {
    const result = await runMcpx(
      ["/test", "add", "--params", '{"a": 1, "b": 2}'],
      { configDir }
    );

    // Should be exactly one JSON object, not multiple lines
    const lines = result.stdout.split("\n").filter((l) => l.trim());
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveProperty("ok");
  }, 30_000);

  // --- error codes map to exit codes ---

  it("exit code 3 for validation errors", async () => {
    const result = await runMcpx(
      ["/test", "nonexistent", "--params", "{}"],
      { configDir }
    );
    expect(result.exitCode).toBe(3);
  }, 30_000);

  it("exit code 4 for config/server errors", async () => {
    const result = await runMcpx(
      ["/unknown-server", "tool", "--params", "{}"],
      { configDir }
    );
    expect(result.exitCode).toBe(4);
  }, 15_000);

  it("exit code 1 for tool execution errors", async () => {
    const result = await runMcpx(
      ["/test", "fail", "--params", "{}"],
      { configDir }
    );
    expect(result.exitCode).toBe(1);
  }, 30_000);

  // --- error envelope includes exit code in error.code ---

  it("error.code matches the process exit code", async () => {
    const results = await Promise.all([
      runMcpx(["/test", "fail", "--params", "{}"], { configDir }),
      runMcpx(["/test", "nonexistent", "--params", "{}"], { configDir }),
      runMcpx(["/unknown", "tool", "--params", "{}"], { configDir }),
    ]);

    for (const result of results) {
      expect(result.json).not.toBeNull();
      expect(result.json!.ok).toBe(false);
      expect(result.json!.error!.code).toBe(result.exitCode);
    }
  }, 30_000);

  // --- list output is also enveloped ---

  it("list command returns tools in envelope format", async () => {
    const result = await runMcpx(["list", "/test"], { configDir });

    expectSuccess(result);

    // Tools should be in the envelope, not raw
    expect(result.json).toHaveProperty("ok", true);
    expect(result.json).toHaveProperty("tools");
    expect(Array.isArray(result.json!.tools)).toBe(true);
  }, 30_000);
});
