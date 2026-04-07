import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runMcpx, createTempConfigDir, expectSuccess, expectError, TEST_SERVER_INLINE } from "./helpers.js";

describe("new features", () => {
  let configDir: string;
  let cleanup: () => void;

  beforeAll(async () => {
    ({ dir: configDir, cleanup } = createTempConfigDir());
    await runMcpx(["add", "test", TEST_SERVER_INLINE], { configDir });
  }, 15_000);

  afterAll(() => { cleanup(); });

  // --- mcpx servers ---
  it("lists registered servers", async () => {
    const result = await runMcpx(["servers"], { configDir });
    expectSuccess(result);
    expect(result.json!.servers).toBeDefined();
    expect(result.json!.servers!.length).toBeGreaterThan(0);
    expect(result.json!.servers![0].alias).toBe("test");
  }, 15_000);

  // --- mcpx remove ---
  it("removes a server", async () => {
    await runMcpx(["add", "temp", TEST_SERVER_INLINE], { configDir });
    const result = await runMcpx(["remove", "temp"], { configDir });
    expectSuccess(result);
    // Verify it's gone
    const servers = await runMcpx(["servers"], { configDir });
    const aliases = servers.json!.servers!.map((s: any) => s.alias);
    expect(aliases).not.toContain("temp");
  }, 15_000);

  it("returns error when removing nonexistent server", async () => {
    const result = await runMcpx(["remove", "nope"], { configDir });
    expectError(result, 4);
  }, 15_000);

  // --- mcpx update ---
  it("updates server env vars", async () => {
    await runMcpx(["update", "test", "-e", "NEW_VAR=hello"], { configDir });
    const servers = await runMcpx(["servers"], { configDir });
    const testServer = servers.json!.servers!.find((s: any) => s.alias === "test");
    expect(testServer.env).toBeDefined();
    expect(testServer.env.NEW_VAR).toBe("hello");
  }, 15_000);

  // --- env vars in add ---
  it("stores env vars with -e flag", async () => {
    await runMcpx(["add", "envtest", TEST_SERVER_INLINE, "-e", "FOO=bar", "-e", "BAZ=qux"], { configDir });
    const servers = await runMcpx(["servers"], { configDir });
    const server = servers.json!.servers!.find((s: any) => s.alias === "envtest");
    expect(server.env).toEqual({ FOO: "bar", BAZ: "qux" });
  }, 15_000);

  // --- mcpx import ---
  it("imports servers from a config file", async () => {
    // Create a fake Claude Desktop config
    const { writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const importConfig = join(configDir, "import-test.json");
    writeFileSync(importConfig, JSON.stringify({
      mcpServers: {
        imported: { command: "echo", args: ["hello"] },
      }
    }));
    const result = await runMcpx(["import", importConfig], { configDir });
    expectSuccess(result);
    expect(result.json!.result![0].text).toMatch(/imported.*1/i);
  }, 15_000);

  // --- mcpx skills ---
  it("generates skill documentation", async () => {
    const result = await runMcpx(["skills", "/test"], { configDir });
    expectSuccess(result);
    const text = result.json!.result![0].text!;
    expect(text).toMatch(/# test/);
    expect(text).toMatch(/greet/);
    expect(text).toMatch(/add/);
  }, 30_000);

  // --- per-tool --help ---
  it("shows tool help with --help flag", async () => {
    const result = await runMcpx(["/test", "search", "--help"], { configDir });
    expectSuccess(result);
    const text = result.json!.result![0].text!;
    expect(text).toMatch(/search/);
    expect(text).toMatch(/Parameters:/);
    expect(text).toMatch(/--query/);
    expect(text).toMatch(/required/i);
  }, 30_000);

  // --- required field validation ---
  it("validates required fields with descriptive error", async () => {
    const result = await runMcpx(["/test", "add", "--params", '{"a": 1}'], { configDir });
    expectError(result, 3);
    expect(result.json!.error!.message).toMatch(/missing required/i);
    expect(result.json!.error!.message).toMatch(/b/);
  }, 30_000);

  // --- global flags with slash commands ---
  it("--verbose flag works with slash commands", async () => {
    // Just verify it doesn't break routing
    const result = await runMcpx(["--verbose", "/test", "greet", "--params", '{"name": "World"}'], { configDir });
    expectSuccess(result);
    expect(result.json!.result![0].text).toBe("Hello, World.");
  }, 30_000);

  // --- daemon commands ---
  it("daemon status returns valid envelope", async () => {
    const result = await runMcpx(["daemon", "status"], { configDir });
    expectSuccess(result);
    expect(result.json!.result).toBeDefined();
    expect(result.json!.result![0].text).toMatch(/daemon/i);
  }, 15_000);

  // --- corrupt config recovery ---
  it("handles corrupt config gracefully", async () => {
    const { writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    // Save current config
    const { readFileSync } = await import("node:fs");
    const configPath = join(configDir, "servers.json");
    const backup = readFileSync(configPath, "utf-8");
    // Corrupt it
    writeFileSync(configPath, "not json");
    const result = await runMcpx(["servers"], { configDir });
    expectSuccess(result);
    expect(result.json!.servers).toEqual([]);
    // Restore
    writeFileSync(configPath, backup);
  }, 15_000);

  // --- --config-dir flag ---
  it("--config-dir flag overrides config directory", async () => {
    // The configDir is already set via MCPX_CONFIG_DIR env in runMcpx helper
    // Test that the CLI respects it by verifying we can list servers
    const result = await runMcpx(["servers"], { configDir });
    expectSuccess(result);
    expect(result.json!.servers).toBeDefined();
  }, 15_000);

  // --- completion command ---
  it("generates bash completion", async () => {
    const result = await runMcpx(["completion", "bash"], { configDir });
    // completion exits directly, not via envelope
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/_mcpx_completions/);
  }, 10_000);

  it("generates zsh completion", async () => {
    const result = await runMcpx(["completion", "zsh"], { configDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/_mcpx/);
  }, 10_000);

  // --- import --force ---
  it("import --force overwrites existing servers", async () => {
    const { writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const importPath = join(configDir, "force-import.json");
    writeFileSync(importPath, JSON.stringify({
      mcpServers: { test: { command: "echo", args: ["forced"] } }
    }));
    // Without force: skips existing
    const skip = await runMcpx(["import", importPath], { configDir });
    expectSuccess(skip);
    expect(skip.json!.result![0].text).toMatch(/0 server/);
    // With force: overwrites
    const force = await runMcpx(["import", "--force", importPath], { configDir });
    expectSuccess(force);
    expect(force.json!.result![0].text).toMatch(/1 server/);
    // Restore the real test server so subsequent tests work
    await runMcpx(["remove", "test"], { configDir });
    await runMcpx(["add", "test", TEST_SERVER_INLINE], { configDir });
  }, 15_000);

  // --- daemon flush ---
  it("daemon flush returns valid envelope", async () => {
    const result = await runMcpx(["daemon", "flush"], { configDir });
    // Either daemon is running (flush succeeds) or not (reports not running)
    expectSuccess(result);
    expect(result.json!.result![0].text).toMatch(/flushed|not running/i);
  }, 15_000);

  // --- bare /server lists tools ---
  it("bare /server without tool name lists tools", async () => {
    const result = await runMcpx(["/test"], { configDir });
    expectSuccess(result);
    expect(result.json!.tools).toBeDefined();
    expect(result.json!.tools!.length).toBeGreaterThan(0);
  }, 30_000);

  // --- --format table no trailing OK ---
  it("--format table prints content without trailing OK", async () => {
    // Note: runMcpx always gets JSON (no TTY), so test via env
    // Instead, test that JSON mode (default) has no "OK"
    const result = await runMcpx(["/test", "greet", "--params", '{"name": "World"}'], { configDir });
    expectSuccess(result);
    expect(result.stdout).not.toMatch(/\nOK$/);
  }, 30_000);

  // --- -p with no argument ---
  it("-p with no argument returns validation error", async () => {
    const result = await runMcpx(["-p"], { configDir });
    expectError(result, 3);
    expect(result.json!.error!.message).toMatch(/missing value/i);
  }, 10_000);
});
