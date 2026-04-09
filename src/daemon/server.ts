import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { homedir } from "node:os";
import { unlinkSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { McpClient } from "../mcp/client.js";
import type { ServerConfig } from "../mcp/config.js";
import { DAEMON_PROTOCOL_VERSION, type DaemonRequest, type DaemonResponse } from "./protocol.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

export function buildToolIndex(tools: Tool[]): Map<string, Tool> {
  const index = new Map<string, Tool>();
  for (const tool of tools) {
    index.set(tool.name, tool);
  }
  return index;
}

function getSocketPath(): string {
  const dir = process.env.MCPX_CONFIG_DIR ?? join(homedir(), ".config", "mcpx");
  if (process.platform === "win32") {
    // Windows named pipe
    return `\\\\.\\pipe\\mcpx-${dir.replace(/[\\/:]/g, "-")}`;
  }
  return join(dir, "daemon.sock");
}

class ConnectionPool {
  private connections = new Map<string, { client: McpClient; tools: Tool[]; toolIndex: Map<string, Tool> }>();

  has(alias: string): boolean {
    return this.connections.has(alias);
  }

  async getOrConnect(alias: string, config?: ServerConfig): Promise<{ client: McpClient; tools: Tool[]; toolIndex: Map<string, Tool> }> {
    const existing = this.connections.get(alias);
    if (existing) return existing;

    if (!config) throw new Error(`No config for alias "${alias}"`);

    const client = new McpClient();
    await client.connect(config, { verbose: false });
    const tools = await client.listTools();
    const toolIndex = buildToolIndex(tools);
    const entry = { client, tools, toolIndex };
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

export class ResultCache {
  private cache = new Map<string, { result: unknown; expiry: number }>();
  private maxSize: number;

  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
  }

  get(key: string): unknown | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return undefined;
    }
    // LRU: move to end (most recent) by re-inserting
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.result;
  }

  set(key: string, result: unknown, ttlMs: number): void {
    // If key already exists, delete first (so re-insert goes to end)
    this.cache.delete(key);
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value!;
      this.cache.delete(oldest);
    }
    this.cache.set(key, { result, expiry: Date.now() + ttlMs });
  }

  clear(): void {
    this.cache.clear();
  }
}

const pool = new ConnectionPool();
const resultCache = new ResultCache(1000);
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
  let processing = Promise.resolve();

  socket.on("data", (chunk) => {
    buffer += chunk.toString();
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      // Queue messages to prevent concurrent pool access races
      processing = processing.then(() => handleMessage(socket, line)).catch(() => {});
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
      respond({ id: req.id, result: "pong", protocolVersion: DAEMON_PROTOCOL_VERSION });
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

    if (req.method === "flush") {
      resultCache.clear();
      if (req.serverAlias) {
        await pool.remove(req.serverAlias);
        respond({ id: req.id, result: `Flushed connection for ${req.serverAlias}` });
      } else {
        await pool.closeAll();
        respond({ id: req.id, result: "Flushed all connections" });
      }
      return;
    }

    if (!req.serverConfig && !pool.has(req.serverAlias)) {
      respond({ id: req.id, error: "Missing serverConfig for unknown alias" });
      return;
    }

    const { client, tools, toolIndex } = await pool.getOrConnect(req.serverAlias, req.serverConfig);

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
      // Check cache for idempotent/read-only tools
      const tool = toolIndex.get(req.toolName!);
      const annotations = (tool as any)?.annotations;
      const cacheable = annotations?.readOnlyHint || annotations?.idempotentHint;

      if (cacheable) {
        const cacheKey = `${req.serverAlias}:${req.toolName}:${JSON.stringify(req.toolArgs ?? {})}`;
        const cached = resultCache.get(cacheKey);
        if (cached) {
          respond({ id: req.id, result: cached });
          return;
        }
      }

      try {
        const result = await client.callTool(req.toolName!, req.toolArgs ?? {});

        // Cache if cacheable (30 second TTL)
        if (cacheable) {
          const cacheKey = `${req.serverAlias}:${req.toolName}:${JSON.stringify(req.toolArgs ?? {})}`;
          resultCache.set(cacheKey, result, 30_000);
        }

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
  // Restrict socket permissions to owner only (security: env vars with credentials pass through)
  if (process.platform !== "win32") {
    try { chmodSync(socketPath, 0o600); } catch { /* best effort */ }
  }
  // Signal parent that daemon is ready
  if (process.send) process.send("ready");
});

resetIdleTimer();

// Graceful shutdown on signals (Docker stop, kill, Ctrl+C)
async function gracefulShutdown() {
  await pool.closeAll();
  server.close();
  if (process.platform !== "win32" && existsSync(socketPath)) {
    try { unlinkSync(socketPath); } catch { /* ignore */ }
  }
  process.exit(0);
}
process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);
