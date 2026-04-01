import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { McpClient } from "../../src/mcp/client.js";

const TEST_SERVER = {
  command: "npx",
  args: ["tsx", "test/integration/test-server.ts"],
};

describe("mcpx integration", () => {
  let client: McpClient;

  beforeAll(async () => {
    client = new McpClient();
    await client.connect(TEST_SERVER);
  }, 30000);

  afterAll(async () => {
    await client.close();
  });

  it("lists tools from the server", async () => {
    const tools = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("greet");
    expect(names).toContain("add");
    expect(names).toContain("fail");
  });

  it("calls a tool with string args", async () => {
    const result = await client.callTool("greet", { name: "World" });
    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { type: string; text: string }).text;
    expect(text).toBe("Hello, World.");
  });

  it("calls a tool with number args", async () => {
    const result = await client.callTool("add", { a: 2, b: 3 });
    const text = (result.content[0] as { type: string; text: string }).text;
    expect(text).toBe("5");
  });

  it("handles tool errors", async () => {
    const result = await client.callTool("fail", {});
    expect(result.isError).toBe(true);
  });

  it("calls a tool with boolean args", async () => {
    const result = await client.callTool("greet", {
      name: "World",
      excited: true,
    });
    const text = (result.content[0] as { type: string; text: string }).text;
    expect(text).toBe("HELLO World!!!");
  });
});
