/**
 * Category 3: Invocation Evals
 *
 * Tests the core agent flow: construct params → invoke tool → get result.
 * Covers --params JSON, --flag sugar, conflicts, type errors, dry-run.
 *
 * Invocation pattern: mcpx /server tool --params '{"key": "value"}'
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  runMcpx,
  createTempConfigDir,
  expectSuccess,
  expectError,
  TEST_SERVER_INLINE,
} from "./helpers.js";

describe("invocation", () => {
  let configDir: string;
  let cleanup: () => void;

  beforeAll(async () => {
    ({ dir: configDir, cleanup } = createTempConfigDir());
    await runMcpx(["add", "test", TEST_SERVER_INLINE], { configDir });
  }, 15_000);

  afterAll(() => {
    cleanup();
  });

  // --- --params JSON (primary agent path) ---

  it("executes a tool via --params JSON", async () => {
    const result = await runMcpx(
      ["/test", "greet", "--params", '{"name": "World"}'],
      { configDir }
    );

    expectSuccess(result);
    expect(result.json.result).toBeDefined();
    expect(result.json.result!.length).toBeGreaterThan(0);

    const text = result.json.result![0].text;
    expect(text).toBe("Hello, World.");
  }, 30_000);

  it("executes a tool with number params via --params", async () => {
    const result = await runMcpx(
      ["/test", "add", "--params", '{"a": 2, "b": 3}'],
      { configDir }
    );

    expectSuccess(result);
    expect(result.json.result![0].text).toBe("5");
  }, 30_000);

  it("executes a tool with optional params via --params", async () => {
    const result = await runMcpx(
      ["/test", "greet", "--params", '{"name": "World", "excited": true}'],
      { configDir }
    );

    expectSuccess(result);
    expect(result.json.result![0].text).toBe("HELLO World!!!");
  }, 30_000);

  it("executes a tool with array params via --params", async () => {
    const result = await runMcpx(
      ["/test", "search", "--params", '{"query": "test", "tags": ["a", "b"]}'],
      { configDir }
    );

    expectSuccess(result);
    const parsed = JSON.parse(result.json.result![0].text!);
    expect(parsed.tags).toEqual(["a", "b"]);
  }, 30_000);

  // --- per-field flags (human-friendly sugar) ---

  it("executes a tool via per-field flags", async () => {
    const result = await runMcpx(
      ["/test", "greet", "--name", "World"],
      { configDir }
    );

    expectSuccess(result);
    expect(result.json.result![0].text).toBe("Hello, World.");
  }, 30_000);

  it("handles boolean flags", async () => {
    const result = await runMcpx(
      ["/test", "greet", "--name", "World", "--excited"],
      { configDir }
    );

    expectSuccess(result);
    expect(result.json.result![0].text).toBe("HELLO World!!!");
  }, 30_000);

  it("handles number flags with type coercion", async () => {
    const result = await runMcpx(
      ["/test", "add", "--a", "2", "--b", "3"],
      { configDir }
    );

    expectSuccess(result);
    expect(result.json.result![0].text).toBe("5");
  }, 30_000);

  // --- --params takes precedence over flags ---

  it("--params wins when both --params and flags are provided", async () => {
    const result = await runMcpx(
      [
        "/test", "greet",
        "--name", "FromFlag",
        "--params", '{"name": "FromParams"}',
      ],
      { configDir }
    );

    expectSuccess(result);
    // --params should take precedence
    expect(result.json.result![0].text).toBe("Hello, FromParams.");
  }, 30_000);

  // --- validation errors ---

  it("returns validation error for missing required param", async () => {
    const result = await runMcpx(
      ["/test", "add", "--params", '{"a": 2}'],
      { configDir }
    );

    // Missing 'b' — should be exit code 3 (validation) or 1 (tool error)
    // The important thing: it fails with a meaningful error
    expect(result.exitCode).toBeGreaterThan(0);
    expect(result.json).not.toBeNull();

    if (result.exitCode === 3) {
      // Ideal: CLI catches missing required field before calling tool
      expect(result.json!.ok).toBe(false);
      expect(result.json!.error!.message).toMatch(/b|required/i);
    } else {
      // Acceptable: MCP server rejects the call
      expect(result.json!.ok).toBe(false);
    }
  }, 30_000);

  it("returns validation error for wrong type", async () => {
    const result = await runMcpx(
      ["/test", "add", "--params", '{"a": "not-a-number", "b": 3}'],
      { configDir }
    );

    expect(result.exitCode).toBeGreaterThan(0);
    expect(result.json).not.toBeNull();
    expect(result.json!.ok).toBe(false);
  }, 30_000);

  // --- tool errors (isError: true from MCP server) ---

  it("returns exit code 1 for tool errors", async () => {
    const result = await runMcpx(
      ["/test", "fail", "--params", "{}"],
      { configDir }
    );

    expectError(result, 1);
    expect(result.json!.error!.message).toMatch(/something went wrong/i);
  }, 30_000);

  // --- unknown tool ---

  it("returns validation error for unknown tool name", async () => {
    const result = await runMcpx(
      ["/test", "nonexistent", "--params", "{}"],
      { configDir }
    );

    expectError(result, 3);
    expect(result.json!.error!.message).toMatch(/nonexistent/i);
  }, 30_000);

  // --- dry-run ---

  it("--dry-run shows what would be sent without executing", async () => {
    const result = await runMcpx(
      ["/test", "greet", "--params", '{"name": "World"}', "--dry-run"],
      { configDir }
    );

    expect(result.exitCode).toBe(0);
    expect(result.json).not.toBeNull();

    // Dry-run should show the tool name and params but NOT actual tool output
    const output = result.stdout;
    expect(output).toMatch(/greet/);
    expect(output).toMatch(/World/);

    // Should NOT contain actual tool result
    expect(output).not.toMatch(/Hello, World\./);
  }, 30_000);

  // --- empty params ---

  it("handles tool with no required params", async () => {
    const result = await runMcpx(
      ["/test", "fail", "--params", "{}"],
      { configDir }
    );

    // fail tool returns isError:true but the invocation itself is valid
    expect(result.json).not.toBeNull();
    expect(result.exitCode).toBe(1); // tool error, not validation error
  }, 30_000);

  // --- --json alias for --params (gws compat) ---

  it("accepts --json as alias for --params", async () => {
    const result = await runMcpx(
      ["/test", "greet", "--json", '{"name": "World"}'],
      { configDir }
    );

    expectSuccess(result);
    expect(result.json.result![0].text).toBe("Hello, World.");
  }, 30_000);
});
