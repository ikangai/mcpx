import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { homedir } from "node:os";
import { unlinkSync, existsSync, mkdirSync } from "node:fs";
import { McpClient } from "../mcp/client.js";
import type { ServerConfig } from "../mcp/config.js";
import type { DaemonRequest, DaemonResponse } from "./protocol.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

function getSocketPath(): string {
  const dir = process.env.MCPX_CONFIG_DIR ?? join(homedir(), ".config", "mcpx");
  if (process.platform === "win32") {
    // Windows named pipe
    return `\\\\.\\pipe\\mcpx-${dir.replace(/[\\/:]/g, "-")}`;
  }
  return join(dir, "daemon.sock");
}

class ConnectionPool {
  private connections = new Map<string, { client: McpClient; tools: Tool[] }>();

  async getOrConnect(alias: string, config: ServerConfig): Promise<{ client: McpClient; tools: Tool[] }> {
    const existing = this.connections.get(alias);
    if (existing) return existing;

    const client = new McpClient();
    await client.connect(config, { verbose: false });
    const tools = await client.listTools();
    const entry = { client, tools };
    this.connections.set(alias, entry);
    return entry;
  }

  async remove(alias: string): Promise<void> {
    const entry = this.connections.get(alias);
    if (entry) {
      try { await entry.client.close(); } catch { /* ignore */ }
      this.connections.delete(alias);
    }
  }

  async closeAll(): Promise<void> {
    for (const [, { client }] of this.connections) {
      try { await client.close(); } catch { /* ignore */ }
    }
    this.connections.clear();
  }
}

const pool = new ConnectionPool();
let idleTimer: ReturnType<typeof setTimeout>;
let server: Server;

function resetIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    await pool.closeAll();
    server.close();
    const socketPath = getSocketPath();
    if (process.platform !== "win32" && existsSync(socketPath)) unlinkSync(socketPath);
    process.exit(0);
  }, IDLE_TIMEOUT);
}

function handleConnection(socket: Socket) {
  let buffer = "";

  socket.on("data", (chunk) => {
    buffer += chunk.toString();
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      handleMessage(socket, line);
    }
  });

  socket.on("error", () => { /* client disconnected */ });
}

async function handleMessage(socket: Socket, rawMessage: string) {
  resetIdleTimer();

  let req: DaemonRequest;
  try {
    req = JSON.parse(rawMessage);
  } catch {
    return;
  }

  const respond = (res: DaemonResponse) => {
    try { socket.write(JSON.stringify(res) + "\n"); } catch { /* socket closed */ }
  };

  try {
    if (req.method === "ping") {
      respond({ id: req.id, result: "pong" });
      return;
    }

    if (req.method === "shutdown") {
      respond({ id: req.id, result: "ok" });
      await pool.closeAll();
      server.close();
      const socketPath = getSocketPath();
      if (process.platform !== "win32" && existsSync(socketPath)) unlinkSync(socketPath);
      process.exit(0);
    }

    if (!req.serverConfig) {
      respond({ id: req.id, error: "Missing serverConfig" });
      return;
    }

    const { client, tools } = await pool.getOrConnect(req.serverAlias, req.serverConfig);

    if (req.method === "listTools") {
      try {
        respond({ id: req.id, result: tools });
      } catch (err) {
        // Connection may be stale — remove from pool so next request reconnects
        await pool.remove(req.serverAlias);
        respond({ id: req.id, error: `listTools failed (connection reset): ${(err as Error).message}` });
      }
      return;
    }

    if (req.method === "callTool") {
      try {
        const result = await client.callTool(req.toolName!, req.toolArgs ?? {});
        respond({ id: req.id, result });
      } catch (err) {
        // Connection may be stale — remove from pool so next request reconnects
        await pool.remove(req.serverAlias);
        respond({ id: req.id, error: `Tool call failed (connection reset): ${(err as Error).message}` });
      }
      return;
    }

    respond({ id: req.id, error: `Unknown method: ${req.method}` });
  } catch (err) {
    respond({ id: req.id, error: (err as Error).message });
  }
}

// Start
const socketPath = getSocketPath();

// Ensure config directory exists (not needed for Windows named pipes)
if (process.platform !== "win32") {
  const socketDir = socketPath.slice(0, socketPath.lastIndexOf("/"));
  mkdirSync(socketDir, { recursive: true });
}

if (process.platform !== "win32" && existsSync(socketPath)) unlinkSync(socketPath);

server = createServer(handleConnection);

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    // Another daemon already started — exit silently
    process.exit(0);
  }
  throw err;
});

server.listen(socketPath, () => {
  // Signal parent that daemon is ready
  if (process.send) process.send("ready");
});

resetIdleTimer();
