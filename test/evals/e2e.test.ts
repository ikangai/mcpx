/**
 * Category 5: End-to-End Agent Ergonomics Evals
 *
 * Simulates the full agent workflow: register → discover → introspect →
 * invoke → parse → handle errors → retry. These are the scenarios an
 * AI agent would actually walk through when using mcpx as a CLI bridge.
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

describe("e2e agent ergonomics", () => {
  let configDir: string;
  let cleanup: () => void;

  beforeAll(async () => {
    ({ dir: configDir, cleanup } = createTempConfigDir());
  }, 5_000);

  afterAll(() => {
    cleanup();
  });

  // --- full discover-and-invoke workflow ---

  it("agent can register → list → schema → invoke in sequence", async () => {
    // Step 1: Register the server
    const addResult = await runMcpx(
      ["add", "tools", TEST_SERVER_INLINE],
      { configDir }
    );
    expect(addResult.exitCode).toBe(0);

    // Step 2: Discover available tools
    const listResult = await runMcpx(["list", "/tools"], { configDir });
    expectSuccess(listResult);
    const tools = listResult.json.tools!;
    expect(tools.length).toBeGreaterThan(0);

    // Step 3: Pick a tool and read its schema
    const targetTool = tools.find((t) => t.name === "search");
    expect(targetTool).toBeDefined();

    const schemaResult = await runMcpx(
      ["schema", "/tools", "search"],
      { configDir }
    );
    expectSuccess(schemaResult);

    // Step 4: Construct params from schema and invoke
    const schema = schemaResult.json.schema!;
    const props = schema.properties as Record<string, { type: string }>;

    // Agent constructs params based on schema
    const params: Record<string, unknown> = {};
    for (const [key, prop] of Object.entries(props)) {
      if (prop.type === "string") params[key] = "agent-query";
      if (prop.type === "number") params[key] = 5;
    }

    const execResult = await runMcpx(
      ["/tools", "search", "--params", JSON.stringify(params)],
      { configDir }
    );

    expectSuccess(execResult);
    const parsed = JSON.parse(execResult.json.result![0].text!);
    expect(parsed.query).toBe("agent-query");
  }, 60_000);

  // --- error recovery workflow ---

  it("agent can recover from a bad invocation by reading the error", async () => {
    // Register
    await runMcpx(["add", "svc", TEST_SERVER_INLINE], { configDir });

    // Step 1: Agent tries with wrong params
    const badResult = await runMcpx(
      ["/svc", "add", "--params", '{"a": 2}'],  // missing 'b'
      { configDir }
    );

    // Should fail with actionable error
    expect(badResult.exitCode).toBeGreaterThan(0);
    expect(badResult.json).not.toBeNull();
    expect(badResult.json!.ok).toBe(false);

    // Step 2: Agent reads the error and fixes params
    const error = badResult.json!.error!;
    expect(error.message.length).toBeGreaterThan(0);

    // Step 3: Agent retries with correct params
    const goodResult = await runMcpx(
      ["/svc", "add", "--params", '{"a": 2, "b": 3}'],
      { configDir }
    );

    expectSuccess(goodResult);
    expect(goodResult.json.result![0].text).toBe("5");
  }, 60_000);

  // --- multi-server workflow ---

  it("agent can work with multiple servers without cross-talk", async () => {
    // Register the same test server under two aliases
    // (In practice these would be different servers)
    await runMcpx(["add", "alpha", TEST_SERVER_INLINE], { configDir });
    await runMcpx(["add", "beta", TEST_SERVER_INLINE], { configDir });

    // Invoke on alpha
    const alphaResult = await runMcpx(
      ["/alpha", "greet", "--params", '{"name": "Alpha"}'],
      { configDir }
    );
    expectSuccess(alphaResult);
    expect(alphaResult.json.result![0].text).toBe("Hello, Alpha.");

    // Invoke on beta
    const betaResult = await runMcpx(
      ["/beta", "greet", "--params", '{"name": "Beta"}'],
      { configDir }
    );
    expectSuccess(betaResult);
    expect(betaResult.json.result![0].text).toBe("Hello, Beta.");

    // Verify they're independent
    expect(alphaResult.json.result![0].text).not.toBe(
      betaResult.json.result![0].text
    );
  }, 60_000);

  // --- roundtrip: input → tool → output preserved exactly ---

  it("preserves data fidelity through the full roundtrip", async () => {
    await runMcpx(["add", "rt", TEST_SERVER_INLINE], { configDir });

    const input = "Hello, 世界! 🌍 <script>alert('xss')</script> \"quotes\" & ampersands";
    const result = await runMcpx(
      ["/rt", "echo", "--params", JSON.stringify({ input })],
      { configDir }
    );

    expectSuccess(result);
    // The echo tool returns the input as-is
    expect(result.json.result![0].text).toBe(input);
  }, 30_000);

  // --- -p shorthand (single-shot invocation string) ---

  it("supports -p shorthand for single-shot invocation", async () => {
    await runMcpx(["add", "quick", TEST_SERVER_INLINE], { configDir });

    const result = await runMcpx(
      ["-p", '/quick greet --params \'{"name": "Shorthand"}\''],
      { configDir }
    );

    expectSuccess(result);
    expect(result.json.result![0].text).toBe("Hello, Shorthand.");
  }, 30_000);

  // --- list all servers (multi-server) ---

  it("list without /server shows tools from all registered servers", async () => {
    // Ensure at least one server is registered from previous tests
    await runMcpx(["add", "all-test", TEST_SERVER_INLINE], { configDir });

    const result = await runMcpx(["list"], { configDir });

    expectSuccess(result);
    expect(result.json.tools!.length).toBeGreaterThan(0);
  }, 30_000);

  // --- idempotent invocation ---

  it("same command produces same output (deterministic)", async () => {
    await runMcpx(["add", "det", TEST_SERVER_INLINE], { configDir });

    const args = ["/det", "add", "--params", '{"a": 10, "b": 20}'] as const;

    const result1 = await runMcpx([...args], { configDir });
    const result2 = await runMcpx([...args], { configDir });

    expectSuccess(result1);
    expectSuccess(result2);

    expect(result1.json.result).toEqual(result2.json.result);
  }, 60_000);
});
