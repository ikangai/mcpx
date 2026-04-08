import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";

function createMcpServer(): McpServer {
  const server = new McpServer({ name: "test-http", version: "1.0.0" });
  server.tool("echo", "Echo back input", { message: z.string() }, async ({ message }) => ({
    content: [{ type: "text", text: message }],
  }));
  return server;
}

export function startTestHttpServer(port: number, expectedToken?: string): Promise<ReturnType<typeof createServer>> {
  return new Promise((resolve) => {
    const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      // Auth check
      if (expectedToken) {
        const auth = req.headers.authorization;
        if (!auth || auth !== `Bearer ${expectedToken}`) {
          res.writeHead(401, { "Content-Type": "text/plain" });
          res.end("Unauthorized");
          return;
        }
      }

      // Only handle POST (stateless mode rejects GET/DELETE)
      if (req.method !== "POST") {
        res.writeHead(405);
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Method not allowed." },
          id: null,
        }));
        return;
      }

      // Parse body
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString());

      // Stateless: new server + transport per request
      const server = createMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, body);

      res.on("close", () => {
        transport.close();
        server.close();
      });
    });
    httpServer.listen(port, () => resolve(httpServer));
  });
}
