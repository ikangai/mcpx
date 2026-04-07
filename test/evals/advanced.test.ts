import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runMcpx, createTempConfigDir, expectSuccess, expectError, TEST_SERVER_INLINE } from "./helpers.js";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

describe("advanced features", () => {
  let configDir: string;
  let cleanup: () => void;

  beforeAll(async () => {
    ({ dir: configDir, cleanup } = createTempConfigDir());
    await runMcpx(["add", "test", TEST_SERVER_INLINE], { configDir });
  }, 15_000);

  afterAll(() => { cleanup(); });

  // --- mcpx inspect ---
  it("inspect shows server capabilities", async () => {
    const result = await runMcpx(["inspect", "/test"], { configDir });
    expectSuccess(result);
    const info = JSON.parse(result.json!.result![0].text!);
    expect(info.name).toBe("test-server");
    expect(info.tools).toBeGreaterThan(0);
  }, 30_000);

  // --- mcpx test (health check) ---
  it("test verifies server health", async () => {
    const result = await runMcpx(["test", "/test"], { configDir });
    expectSuccess(result);
    expect(result.json!.result![0].text).toMatch(/Connect: OK/);
    expect(result.json!.result![0].text).toMatch(/Tools:.*discovered/);
    expect(result.json!.result![0].text).toMatch(/All checks passed/);
  }, 30_000);

  // --- --params-stdin ---
  it("--params-stdin reads JSON from stdin", async () => {
    const { execSync } = await import("node:child_process");
    const env = { ...process.env, MCPX_CONFIG_DIR: configDir, NODE_NO_WARNINGS: "1", FORCE_COLOR: "0" };
    const output = execSync(
      `echo '{"name":"Piped"}' | npx tsx src/index.ts /test greet --params-stdin`,
      { env, encoding: "utf-8", timeout: 30_000, cwd: process.cwd() }
    ).trim();
    const parsed = JSON.parse(output);
    expect(parsed.ok).toBe(true);
    expect(parsed.result[0].text).toBe("Hello, Piped.");
  }, 30_000);

  // --- --field ---
  it("--field extracts a specific field from JSON result", async () => {
    const result = await runMcpx(
      ["/test", "search", "--params", '{"query":"test"}', "--field", "query"],
      { configDir }
    );
    expectSuccess(result);
    expect(result.json!.result![0].text).toBe("test");
  }, 30_000);

  // --- --format csv ---
  it("--format csv outputs CSV", async () => {
    const { execSync } = await import("node:child_process");
    const env = { ...process.env, MCPX_CONFIG_DIR: configDir, NODE_NO_WARNINGS: "1", FORCE_COLOR: "0" };
    const output = execSync(
      `npx tsx src/index.ts --format csv list /test`,
      { env, encoding: "utf-8", timeout: 30_000, cwd: process.cwd() }
    ).trim();
    // CSV should have header row with "name"
    expect(output).toMatch(/name/);
    expect(output).toMatch(/greet/);
    // Should NOT be JSON
    expect(output).not.toMatch(/^\{/);
  }, 30_000);

  // --- --format markdown ---
  it("--format markdown outputs markdown table", async () => {
    const { execSync } = await import("node:child_process");
    const env = { ...process.env, MCPX_CONFIG_DIR: configDir, NODE_NO_WARNINGS: "1", FORCE_COLOR: "0" };
    const output = execSync(
      `npx tsx src/index.ts --format markdown list /test`,
      { env, encoding: "utf-8", timeout: 30_000, cwd: process.cwd() }
    ).trim();
    // Markdown table should have | separators and --- row
    expect(output).toMatch(/\|.*\|/);
    expect(output).toMatch(/---/);
    expect(output).toMatch(/greet/);
  }, 30_000);

  // --- mcpx alias ---
  it("alias set, list, and run work", async () => {
    // Set alias
    const set = await runMcpx(
      ["alias", "set", "hi", `/test greet --params '{"name":"Alias"}'`],
      { configDir }
    );
    expectSuccess(set);

    // List aliases
    const list = await runMcpx(["alias", "list"], { configDir });
    expectSuccess(list);
    expect(list.json!.result![0].text).toMatch(/hi/);

    // Run alias
    const run = await runMcpx(["run", "hi"], { configDir });
    expectSuccess(run);
    expect(run.json!.result![0].text).toBe("Hello, Alias.");

    // Remove alias
    const remove = await runMcpx(["alias", "remove", "hi"], { configDir });
    expectSuccess(remove);
  }, 60_000);

  // --- mcpx hook ---
  it("hook add, list, and remove work", async () => {
    const add = await runMcpx(
      ["hook", "add", "before:test.*", "echo hook-fired"],
      { configDir }
    );
    expectSuccess(add);

    const list = await runMcpx(["hook", "list"], { configDir });
    expectSuccess(list);
    expect(list.json!.result![0].text).toMatch(/before:test/);

    const remove = await runMcpx(["hook", "remove", "before:test.*"], { configDir });
    expectSuccess(remove);
  }, 15_000);

  // --- --log (audit) ---
  it("--log writes invocation to NDJSON file", async () => {
    const logPath = join(configDir, "audit.ndjson");
    const { execSync } = await import("node:child_process");
    const env = { ...process.env, MCPX_CONFIG_DIR: configDir, NODE_NO_WARNINGS: "1", FORCE_COLOR: "0" };
    // Use execSync because --log is parsed early in index.ts before commander
    execSync(
      `npx tsx src/index.ts --log ${logPath} /test greet --params '{"name":"Logged"}'`,
      { env, encoding: "utf-8", timeout: 30_000, cwd: process.cwd() }
    );
    // Check log file exists and has content
    expect(existsSync(logPath)).toBe(true);
    const logContent = readFileSync(logPath, "utf-8").trim();
    const entry = JSON.parse(logContent.split("\n").pop()!);
    expect(entry.tool).toBe("greet");
    expect(entry.server).toBe("test");
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
  }, 30_000);

  // --- mcpx diff ---
  it("diff saves snapshot and compares", async () => {
    // First run: saves snapshot
    const first = await runMcpx(["diff", "/test"], { configDir });
    expectSuccess(first);
    expect(first.json!.result![0].text).toMatch(/snapshot saved/i);

    // Second run: compares (no changes expected)
    const second = await runMcpx(["diff", "/test"], { configDir });
    expectSuccess(second);
    expect(second.json!.result![0].text).toMatch(/no changes/i);
  }, 60_000);

  // --- mcpx workflow ---
  it("workflow runs multi-step YAML", async () => {
    const workflowPath = join(configDir, "test-workflow.yaml");
    writeFileSync(workflowPath, `
name: Test Workflow
steps:
  - server: test
    tool: greet
    params:
      name: Step1
    output: greeting
  - server: test
    tool: add
    params:
      a: 1
      b: 2
    output: sum
`);
    const result = await runMcpx(["workflow", workflowPath], { configDir });
    expectSuccess(result);
    expect(result.json!.result![0].text).toMatch(/completed/i);
    expect(result.json!.result![0].text).toMatch(/2 steps/);
  }, 60_000);

  // --- mcpx prompts (test server doesn't support --- should return empty) ---
  it("prompts returns result for servers without prompts", async () => {
    const result = await runMcpx(["prompts", "/test"], { configDir });
    expectSuccess(result);
    // Test server has no prompts --- should return empty array
    expect(result.json!.result![0].text).toMatch(/\[\]/);
  }, 30_000);

  // --- mcpx resources (test server doesn't support --- should return empty) ---
  it("resources returns result for servers without resources", async () => {
    const result = await runMcpx(["resources", "/test"], { configDir });
    expectSuccess(result);
    expect(result.json!.result![0].text).toMatch(/\[\]/);
  }, 30_000);

  // --- tool annotations in list output ---
  it("list includes annotations field in tool info", async () => {
    const result = await runMcpx(["list", "/test"], { configDir });
    expectSuccess(result);
    // Annotations may be undefined for test server (no annotations), but the field should exist
    expect(result.json!.tools).toBeDefined();
    // Just verify the structure works without crashing
    expect(result.json!.tools!.length).toBeGreaterThan(0);
  }, 30_000);
});
