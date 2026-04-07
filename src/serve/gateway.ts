import { createServer as createHttpServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpClient } from "../mcp/client.js";
import { getAllServers } from "../config/store.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

interface PoolEntry {
  client: McpClient;
  tools: Tool[];
}

export async function startGateway(opts?: { verbose?: boolean; port?: number; token?: string }): Promise<void> {
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
      pool.set(alias, { client, tools });

      // Register each tool with namespaced name: alias.toolName
      for (const tool of tools) {
        const namespacedName = `${alias}.${tool.name}`;
        const schema = tool.inputSchema as {
          properties?: Record<string, unknown>;
          required?: string[];
        };

        // Build zod schema from JSON schema properties
        const zodProps: Record<string, z.ZodTypeAny> = {};
        const props = schema.properties ?? {};
        for (const [propName, propSchema] of Object.entries(props)) {
          const p = propSchema as { type?: string; description?: string };
          let zodType: z.ZodTypeAny;
          switch (p.type) {
            case "string": zodType = z.string(); break;
            case "number": case "integer": zodType = z.number(); break;
            case "boolean": zodType = z.boolean(); break;
            default: zodType = z.any(); break;
          }
          if (p.description) zodType = zodType.describe(p.description);
          const isRequired = (schema.required ?? []).includes(propName);
          zodProps[propName] = isRequired ? zodType : zodType.optional();
        }

        server.tool(
          namespacedName,
          tool.description ?? "",
          zodProps,
          async (args) => {
            const entry = pool.get(alias);
            if (!entry) {
              return { content: [{ type: "text" as const, text: `Server "${alias}" not connected` }], isError: true };
            }
            try {
              const result = await entry.client.callTool(tool.name, args) as {
                content: Array<{ type: "text"; text: string }>;
                isError?: boolean;
              };
              return {
                content: result.content.map((c) => ({ type: "text" as const, text: c.text ?? "" })),
                isError: result.isError,
              };
            } catch (err) {
              return { content: [{ type: "text" as const, text: (err as Error).message }], isError: true };
            }
          }
        );
      }
    } catch (err) {
      if (opts?.verbose) {
        process.stderr.write(`Warning: Failed to connect to ${alias}: ${(err as Error).message}\n`);
      }
    }
  }

  const totalTools = Array.from(pool.values()).reduce((sum, e) => sum + e.tools.length, 0);
  process.stderr.write(`mcpx gateway: ${pool.size} server(s), ${totalTools} tool(s)\n`);

  // Resolve authentication token (CLI flag takes precedence over env var)
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
      // Bearer token authentication
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
            const tools: Array<Tool & { name: string }> = [];
            for (const [alias, entry] of pool) {
              for (const t of entry.tools) {
                tools.push({ ...t, name: `${alias}.${t.name}` });
              }
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { tools } }));
          } else if (request.method === "tools/call") {
            const { name, arguments: args } = request.params;
            const [alias, ...rest] = name.split(".");
            const toolName = rest.join(".");
            const entry = pool.get(alias);
            if (!entry) {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -1, message: `Server "${alias}" not found` } }));
              return;
            }
            const result = await entry.client.callTool(toolName, args ?? {});
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
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
    // Stdio mode (existing)
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}
