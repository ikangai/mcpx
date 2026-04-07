/**
 * Category 2: Schema Introspection Evals
 *
 * Tests `mcpx schema /server tool` — the agent's primary way to
 * understand a tool's input contract before constructing --params JSON.
 * Mirrors gws's `gws schema drive.files.list` pattern.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  runMcpx,
  createTempConfigDir,
  expectSuccess,
  expectError,
  TEST_SERVER_INLINE,
} from "./helpers.js";

describe("schema introspection", () => {
  let configDir: string;
  let cleanup: () => void;

  beforeAll(async () => {
    ({ dir: configDir, cleanup } = createTempConfigDir());
    // Register the test server
    await runMcpx(["add", "test", TEST_SERVER_INLINE], { configDir });
  }, 15_000);

  afterAll(() => {
    cleanup();
  });

  // --- basic schema ---

  it("returns schema for a simple tool", async () => {
    const result = await runMcpx(["schema", "/test", "add"], { configDir });

    expectSuccess(result);
    expect(result.json.schema).toBeDefined();

    const schema = result.json.schema!;
    expect(schema.properties).toBeDefined();

    const props = schema.properties as Record<string, { type: string }>;
    expect(props.a).toBeDefined();
    expect(props.a.type).toBe("number");
    expect(props.b).toBeDefined();
    expect(props.b.type).toBe("number");
  }, 30_000);

  it("includes required fields in schema", async () => {
    const result = await runMcpx(["schema", "/test", "add"], { configDir });

    expectSuccess(result);

    const schema = result.json.schema!;
    const required = schema.required as string[];
    expect(required).toContain("a");
    expect(required).toContain("b");
  }, 30_000);

  // --- complex schema (optional + array params) ---

  it("returns schema for a tool with optional and array params", async () => {
    const result = await runMcpx(["schema", "/test", "search"], { configDir });

    expectSuccess(result);

    const schema = result.json.schema!;
    const props = schema.properties as Record<string, { type: string }>;

    // Required
    expect(props.query).toBeDefined();
    expect(props.query.type).toBe("string");

    // Optional number
    expect(props.limit).toBeDefined();

    // Optional array
    expect(props.tags).toBeDefined();
  }, 30_000);

  it("distinguishes required from optional in schema output", async () => {
    const result = await runMcpx(["schema", "/test", "search"], { configDir });

    expectSuccess(result);

    const schema = result.json.schema!;
    const required = (schema.required ?? []) as string[];

    expect(required).toContain("query");
    expect(required).not.toContain("limit");
    expect(required).not.toContain("tags");
  }, 30_000);

  // --- tool description included ---

  it("includes tool description in schema output", async () => {
    const result = await runMcpx(["schema", "/test", "greet"], { configDir });

    expectSuccess(result);

    // The schema envelope should include the tool description so agents
    // know what the tool does alongside its parameters
    expect(result.json.schema!.description ?? result.stdout).toMatch(/greet/i);
  }, 30_000);

  // --- error cases ---

  it("returns validation error for unknown tool", async () => {
    const result = await runMcpx(
      ["schema", "/test", "nonexistent"],
      { configDir }
    );

    expectError(result, 3);
    expect(result.json!.error!.message).toMatch(/nonexistent/i);
  }, 30_000);

  it("returns config error for unknown server", async () => {
    const result = await runMcpx(
      ["schema", "/nope", "anything"],
      { configDir }
    );

    expectError(result, 4);
    expect(result.json!.error!.message).toMatch(/nope/i);
  }, 15_000);

  // --- schema is machine-readable ---

  it("returns valid JSON Schema that an agent can use to construct params", async () => {
    const result = await runMcpx(["schema", "/test", "search"], { configDir });

    expectSuccess(result);

    const schema = result.json.schema!;

    // Must have the standard JSON Schema fields agents need
    expect(schema).toHaveProperty("type");
    expect(schema).toHaveProperty("properties");

    // An agent should be able to construct valid --params from this
    const props = schema.properties as Record<string, { type: string }>;
    const paramObj: Record<string, unknown> = {};
    for (const [key, prop] of Object.entries(props)) {
      if (prop.type === "string") paramObj[key] = "test";
      if (prop.type === "number") paramObj[key] = 42;
    }
    expect(paramObj.query).toBe("test");
  }, 30_000);
});
