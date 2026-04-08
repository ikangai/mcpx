import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestHttpServer } from "./http-server.js";
import { McpClient } from "../../src/mcp/client.js";

const PORT = 9877;
let server: any;

describe("HTTP transport", () => {
  beforeAll(async () => {
    server = await startTestHttpServer(PORT);
  });

  afterAll(() => {
    server?.close();
  });

  it("connects to HTTP MCP server and lists tools", async () => {
    const client = new McpClient();
    await client.connect({ url: `http://localhost:${PORT}` });
    const tools = await client.listTools();
    expect(tools.some(t => t.name === "echo")).toBe(true);
    await client.close();
  });

  it("calls a tool over HTTP", async () => {
    const client = new McpClient();
    await client.connect({ url: `http://localhost:${PORT}` });
    const result = await client.callTool("echo", { message: "hello" }) as any;
    expect(result.content[0].text).toBe("hello");
    await client.close();
  });
});

describe("HTTP transport with auth", () => {
  const AUTH_PORT = 9878;
  let authServer: any;

  beforeAll(async () => {
    authServer = await startTestHttpServer(AUTH_PORT, "test-token-123");
  });

  afterAll(() => {
    authServer?.close();
  });

  it("fails without token", async () => {
    const client = new McpClient();
    await expect(client.connect({ url: `http://localhost:${AUTH_PORT}` })).rejects.toThrow();
    await client.close();
  });

  it("succeeds with correct Bearer token header", async () => {
    const client = new McpClient();
    await client.connect({
      url: `http://localhost:${AUTH_PORT}`,
      headers: { Authorization: "Bearer test-token-123" },
    });
    const tools = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
    await client.close();
  });
});
