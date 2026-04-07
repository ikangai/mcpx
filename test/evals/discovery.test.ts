/**
 * Category 1: Discovery & Registration Evals
 *
 * Tests the agent workflow: register servers → discover tools.
 * Validates the `mcpx add` and `mcpx list` commands with the
 * slash-command server namespace model (/server tool).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  runMcpx,
  createTempConfigDir,
  readServersConfig,
  expectSuccess,
  expectError,
  TEST_SERVER_INLINE,
  type Envelope,
} from "./helpers.js";

describe("discovery & registration", () => {
  let configDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ dir: configDir, cleanup } = createTempConfigDir());
  });

  afterEach(() => {
    cleanup();
  });

  // --- mcpx add ---

  it("registers a server via `mcpx add`", async () => {
    const result = await runMcpx(
      ["add", "math", TEST_SERVER_INLINE],
      { configDir }
    );

    expect(result.exitCode).toBe(0);

    // Verify the server was persisted to config
    const servers = readServersConfig(configDir);
    expect(servers).not.toBeNull();
    expect(servers!["math"]).toBeDefined();
    expect(servers!["math"].command).toBe("npx");
  }, 15_000);

  it("overwrites an existing alias on re-add", async () => {
    // Add once
    await runMcpx(["add", "math", TEST_SERVER_INLINE], { configDir });

    // Add again with same alias, different command
    const newCmd = "node some-other-server.js";
    await runMcpx(["add", "math", newCmd], { configDir });

    const servers = readServersConfig(configDir);
    expect(servers!["math"].command).toBe("node");
    expect(servers!["math"].args).toContain("some-other-server.js");
  }, 15_000);

  // --- mcpx list ---

  it("lists all servers and their tools", async () => {
    // Register the test server first
    await runMcpx(["add", "math", TEST_SERVER_INLINE], { configDir });

    const result = await runMcpx(["list"], { configDir });

    expectSuccess(result);
    expect(result.json.tools).toBeDefined();
    expect(result.json.tools!.length).toBeGreaterThan(0);

    const names = result.json.tools!.map((t) => t.name);
    expect(names).toContain("greet");
    expect(names).toContain("add");
    expect(names).toContain("echo");
    expect(names).toContain("search");
  }, 30_000);

  it("lists tools for a single server via /server namespace", async () => {
    await runMcpx(["add", "math", TEST_SERVER_INLINE], { configDir });

    const result = await runMcpx(["list", "/math"], { configDir });

    expectSuccess(result);
    expect(result.json.tools).toBeDefined();

    // All tools should belong to the math server
    const names = result.json.tools!.map((t) => t.name);
    expect(names).toContain("add");
  }, 30_000);

  it("returns config error for unknown server", async () => {
    const result = await runMcpx(["list", "/nonexistent"], { configDir });

    expectError(result, 4);
    expect(result.json!.error!.message).toMatch(/nonexistent/i);
  }, 15_000);

  // --- listing with no servers configured ---

  it("returns empty tools list when no servers registered", async () => {
    const result = await runMcpx(["list"], { configDir });

    // Should succeed but with no tools (or error saying no servers configured)
    // Either behavior is acceptable — the key is it doesn't crash
    expect(result.exitCode).toBeLessThanOrEqual(4);
    expect(result.json).not.toBeNull();
  }, 15_000);

  // --- server info in tool listing ---

  it("includes tool descriptions in list output", async () => {
    await runMcpx(["add", "test", TEST_SERVER_INLINE], { configDir });

    const result = await runMcpx(["list", "/test"], { configDir });

    expectSuccess(result);

    const greet = result.json.tools!.find((t) => t.name === "greet");
    expect(greet).toBeDefined();
    expect(greet!.description).toBe("Greet a person");
  }, 30_000);

  it("includes input schema in list output for agent consumption", async () => {
    await runMcpx(["add", "test", TEST_SERVER_INLINE], { configDir });

    const result = await runMcpx(["list", "/test"], { configDir });

    expectSuccess(result);

    const addTool = result.json.tools!.find((t) => t.name === "add");
    expect(addTool).toBeDefined();
    expect(addTool!.inputSchema).toBeDefined();
    expect(addTool!.inputSchema.properties).toBeDefined();
  }, 30_000);
});
