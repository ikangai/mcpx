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

server.tool(
  "echo",
  "Echoes back the input as JSON — useful for roundtrip testing",
  { input: z.string() },
  async ({ input }) => {
    return { content: [{ type: "text", text: input }] };
  }
);

server.tool(
  "search",
  "Search items with optional filters",
  {
    query: z.string(),
    limit: z.number().optional(),
    tags: z.array(z.string()).optional(),
  },
  async ({ query, limit, tags }) => {
    const results = {
      query,
      limit: limit ?? 10,
      tags: tags ?? [],
      hits: [
        { id: 1, title: `Result for "${query}"` },
        { id: 2, title: `Another result for "${query}"` },
      ],
    };
    return { content: [{ type: "text", text: JSON.stringify(results) }] };
  }
);

server.tool(
  "validate",
  "Validate an email address format",
  { email: z.string().email() },
  async ({ email }) => {
    return {
      content: [{ type: "text", text: JSON.stringify({ email, valid: true }) }],
    };
  }
);

server.tool(
  "multi-content",
  "Returns multiple content items",
  {},
  async () => {
    return {
      content: [
        { type: "text", text: "First item" },
        { type: "text", text: "Second item" },
        { type: "text", text: JSON.stringify({ third: true }) },
      ],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
