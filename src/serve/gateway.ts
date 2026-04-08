import { createServer as createHttpServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpClient } from "../mcp/client.js";
import { getAllServers } from "../config/store.js";
import type { ServerConfig } from "../mcp/config.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

// zod is an optional dependency — only needed for stdio gateway mode
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let z: any;

interface PoolEntry {
  client: McpClient;
  tools: Tool[];
  config: ServerConfig;
}

/**
 * Build a concise tool catalog for the single-tool description.
 * Keep it short — this goes into the LLM's context for every session.
 */
function buildCatalog(pool: Map<string, PoolEntry>): string {
  const lines: string[] = [];
  for (const [alias, entry] of pool) {
    lines.push(`\n${alias}:`);
    for (const t of entry.tools) {
      const schema = t.inputSchema as { required?: string[]; properties?: Record<string, { type?: string }> };
      const params = Object.entries(schema.properties ?? {})
        .map(([name, prop]) => {
          const req = (schema.required ?? []).includes(name) ? "*" : "";
          return `${name}${req}`;
        })
        .join(", ");
      lines.push(`  ${t.name}(${params}) — ${(t.description ?? "").slice(0, 80)}`);
    }
  }
  return lines.join("\n");
}

export async function startGateway(opts?: { verbose?: boolean; port?: number; token?: string }): Promise<void> {
  try {
    z = await import("zod");
  } catch {
    process.stderr.write("Error: 'zod' is required for mcpx serve. Install it: npm install zod\n");
    process.exit(1);
  }

  const server = new McpServer({
    name: "mcpx-gateway",
    version: "0.1.0",
  });

  const servers = getAllServers();
  const pool = new Map<string, PoolEntry>();

  // Connect to all registered servers and discover tools
  for (const [alias, config] of Object.entries(servers)) {
    try {
      const client = new McpClient();
      await client.connect(config, { verbose: opts?.verbose ?? false, timeout: 30_000 });
      const tools = await client.listTools();
      pool.set(alias, { client, tools, config });
    } catch (err) {
      if (opts?.verbose) {
        process.stderr.write(`Warning: Failed to connect to ${alias}: ${(err as Error).message}\n`);
      }
    }
  }

  const totalTools = Array.from(pool.values()).reduce((sum, e) => sum + e.tools.length, 0);
  const catalog = buildCatalog(pool);

  process.stderr.write(`mcpx gateway: ${pool.size} server(s), ${totalTools} tool(s)\n`);

  // Register ONE tool instead of N*M tools — dramatically reduces context window usage.
  // This follows the terminalcp pattern: single tool with action routing.
  // See: https://badlogicgames.com/blog/mcp-vs-cli/
  server.tool(
    "mcpx",
    `Execute any tool on any registered MCP server. One tool, all servers.

Usage: {"server": "alias", "tool": "tool_name", "params": {...}}

Available servers and tools:${catalog}

Use "list" action to discover tools: {"action": "list", "server": "alias"}
Use "schema" action for details: {"action": "schema", "server": "alias", "tool": "name"}`,
    {
      action: z.enum(["call", "list", "schema"]).optional().describe("Action: call (default), list, or schema"),
      server: z.string().describe("Server alias"),
      tool: z.string().optional().describe("Tool name (required for call/schema)"),
      params: z.record(z.unknown()).optional().describe("Tool parameters as JSON object"),
    },
    async (args: { action?: string; server: string; tool?: string; params?: Record<string, unknown> }) => {
      const action = args.action ?? "call";
      const entry = pool.get(args.server);

      if (!entry) {
        const available = Array.from(pool.keys()).join(", ");
        return { content: [{ type: "text" as const, text: `Server "${args.server}" not found. Available: ${available}` }], isError: true };
      }

      // List: return tool names and descriptions
      if (action === "list") {
        const lines = entry.tools.map((t) => `${t.name} — ${(t.description ?? "").slice(0, 100)}`);
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      }

      // Schema: return tool input schema
      if (action === "schema") {
        const tool = entry.tools.find((t) => t.name === args.tool);
        if (!tool) {
          return { content: [{ type: "text" as const, text: `Tool "${args.tool}" not found on ${args.server}` }], isError: true };
        }
        return { content: [{ type: "text" as const, text: JSON.stringify({ ...tool.inputSchema, description: tool.description }, null, 2) }] };
      }

      // Call: execute the tool
      if (!args.tool) {
        return { content: [{ type: "text" as const, text: "Missing 'tool' field for call action" }], isError: true };
      }

      try {
        const result = await entry.client.callTool(args.tool, args.params ?? {}) as {
          content: Array<{ type: string; text?: string }>;
          isError?: boolean;
        };
        // Return plain text, not wrapped JSON — token efficient
        const text = result.content
          .filter((c) => c.type === "text" && c.text)
          .map((c) => c.text)
          .join("\n");
        return {
          content: [{ type: "text" as const, text: text || "(no output)" }],
          isError: result.isError,
        };
      } catch (err) {
        // Backend may have crashed — try reconnecting
        pool.delete(args.server);
        try { await entry.client.close(); } catch { /* ignore */ }

        try {
          const newClient = new McpClient();
          await newClient.connect(entry.config, { verbose: opts?.verbose ?? false });
          const newTools = await newClient.listTools();
          pool.set(args.server, { client: newClient, tools: newTools, config: entry.config });
          const result = await newClient.callTool(args.tool, args.params ?? {}) as {
            content: Array<{ type: string; text?: string }>;
            isError?: boolean;
          };
          const text = result.content.filter((c) => c.type === "text" && c.text).map((c) => c.text).join("\n");
          return { content: [{ type: "text" as const, text: text || "(no output)" }], isError: result.isError };
        } catch (retryErr) {
          return { content: [{ type: "text" as const, text: `Server "${args.server}" disconnected: ${(retryErr as Error).message}` }], isError: true };
        }
      }
    }
  );

  // Resolve authentication token
  const token = opts?.token ?? process.env.MCPX_SERVE_TOKEN;

  // Graceful shutdown
  const cleanup = async () => {
    for (const [, { client }] of pool) {
      try { await client.close(); } catch { /* ignore */ }
    }
    process.exit(0);
  };
  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);

  if (opts?.port) {
    if (!token) {
      process.stderr.write("Warning: HTTP server started without --token. Bind to localhost only.\n");
    }

    // HTTP mode — simple JSON-RPC endpoint
    const httpServer = createHttpServer(async (req, res) => {
      if (token) {
        const authHeader = req.headers.authorization;
        if (!authHeader || authHeader !== `Bearer ${token}`) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized" }));
          return;
        }
      }

      if (req.method === "POST" && req.url === "/mcp") {
        let body = "";
        for await (const chunk of req) body += chunk;

        try {
          const request = JSON.parse(body);
          if (request.method === "tools/list") {
            // Return the single mcpx tool
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { tools: [{ name: "mcpx", description: "Execute tools on registered MCP servers" }] } }));
          } else if (request.method === "tools/call") {
            const { arguments: args } = request.params;
            const entry = pool.get(args.server);
            if (!entry) {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -1, message: `Server "${args.server}" not found` } }));
              return;
            }
            if (args.action === "list") {
              const lines = entry.tools.map((t: Tool) => `${t.name} — ${(t.description ?? "").slice(0, 100)}`);
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: lines.join("\n") }] } }));
            } else {
              const result = await entry.client.callTool(args.tool, args.params ?? {});
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
            }
          } else {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Method not found" } }));
          }
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
      } else if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, servers: pool.size, tools: totalTools }));
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    httpServer.listen(opts.port, () => {
      process.stderr.write(`mcpx gateway: HTTP server on port ${opts.port}\n`);
    });
  } else {
    // Stdio mode
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}
