import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "test-server", version: "1.0.0" });

server.tool("greet", "Greet a person", { name: z.string(), excited: z.boolean().optional() }, async ({ name, excited }) => {
  const greeting = excited ? `HELLO ${name}!!!` : `Hello, ${name}.`;
  return { content: [{ type: "text", text: greeting }] };
});

server.tool("add", "Add two numbers", { a: z.number(), b: z.number() }, async ({ a, b }) => {
  return { content: [{ type: "text", text: String(a + b) }] };
});

server.tool("fail", "Always fails", {}, async () => {
  return { content: [{ type: "text", text: "Something went wrong" }], isError: true };
});

const transport = new StdioServerTransport();
await server.connect(transport);
