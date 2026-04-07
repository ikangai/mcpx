import { connect, type Socket } from "node:net";
import { join, resolve as pathResolve, dirname } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { DaemonRequest, DaemonResponse } from "./protocol.js";
import type { ServerConfig } from "../mcp/config.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getSocketPath(): string {
  const dir = process.env.MCPX_CONFIG_DIR ?? join(homedir(), ".config", "mcpx");
  if (process.platform === "win32") {
    // Windows named pipe
    return `\\\\.\\pipe\\mcpx-${dir.replace(/[\\/:]/g, "-")}`;
  }
  return join(dir, "daemon.sock");
}

export class DaemonClient {
  private socket: Socket | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: DaemonResponse) => void; reject: (e: Error) => void }>();
  private buffer = "";
  private knownAliases = new Set<string>();

  async tryConnect(): Promise<boolean> {
    const socketPath = getSocketPath();
    // On Windows, named pipes don't appear as files — skip existsSync check
    if (process.platform !== "win32" && !existsSync(socketPath)) {
      const started = await this.startDaemon();
      if (!started) return false;
    }

    const attemptConnect = (): Promise<boolean> =>
      new Promise((resolvePromise) => {
        const socket = connect(socketPath);
        const timeout = setTimeout(() => {
          socket.destroy();
          resolvePromise(false);
        }, 2000);

        socket.on("connect", () => {
          clearTimeout(timeout);
          this.socket = socket;
          this.setupDataHandler();
          resolvePromise(true);
        });

        socket.on("error", () => {
          clearTimeout(timeout);
          resolvePromise(false);
        });
      });

    const connected = await attemptConnect();
    if (connected) return true;

    // Retry once after a short delay — another daemon instance may still be starting
    await new Promise((r) => setTimeout(r, 500));
    const retryResult = await attemptConnect();

    // If still can't connect and socket file exists, it's stale — clean up
    if (!retryResult && process.platform !== "win32" && existsSync(socketPath)) {
      try { (await import("node:fs")).unlinkSync(socketPath); } catch { /* ignore */ }
    }

    return retryResult;
  }

  private setupDataHandler() {
    this.socket!.on("data", (chunk) => {
      this.buffer += chunk.toString();
      let idx: number;
      while ((idx = this.buffer.indexOf("\n")) !== -1) {
        const line = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + 1);
        try {
          const res = JSON.parse(line) as DaemonResponse;
          const p = this.pending.get(res.id);
          if (p) {
            this.pending.delete(res.id);
            p.resolve(res);
          }
        } catch { /* ignore parse errors */ }
      }
    });
  }

  private async startDaemon(): Promise<boolean> {
    return new Promise((resolvePromise) => {
      const serverPath = pathResolve(__dirname, "server.js");
      const child = fork(serverPath, [], {
        detached: true,
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        env: { ...process.env },
      });

      const timeout = setTimeout(() => {
        resolvePromise(false);
      }, 5000);

      child.on("message", (msg) => {
        if (msg === "ready") {
          clearTimeout(timeout);
          child.unref();
          child.disconnect();
          resolvePromise(true);
        }
      });

      child.on("error", () => {
        clearTimeout(timeout);
        resolvePromise(false);
      });
    });
  }

  private async send(req: Omit<DaemonRequest, "id">): Promise<DaemonResponse> {
    if (!this.socket) throw new Error("Not connected to daemon");

    const id = this.nextId++;
    const fullReq = { ...req, id };

    return new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(new Error("Daemon request timed out"));
      }, 30_000);

      this.pending.set(id, {
        resolve: (res) => { clearTimeout(timeout); resolvePromise(res); },
        reject: (err) => { clearTimeout(timeout); rejectPromise(err); },
      });

      this.socket!.write(JSON.stringify(fullReq) + "\n");
    });
  }

  async listTools(alias: string, config: ServerConfig): Promise<Tool[]> {
    const needsConfig = !this.knownAliases.has(alias);
    const res = await this.send({
      method: "listTools",
      serverAlias: alias,
      ...(needsConfig ? { serverConfig: config } : {}),
    });
    if (res.error) throw new Error(res.error);
    this.knownAliases.add(alias);
    return res.result as Tool[];
  }

  async callTool(alias: string, config: ServerConfig, name: string, args: Record<string, unknown>): Promise<unknown> {
    const needsConfig = !this.knownAliases.has(alias);
    const res = await this.send({
      method: "callTool",
      serverAlias: alias,
      ...(needsConfig ? { serverConfig: config } : {}),
      toolName: name,
      toolArgs: args,
    });
    if (res.error) throw new Error(res.error);
    this.knownAliases.add(alias);
    return res.result;
  }

  async ping(): Promise<boolean> {
    try {
      const res = await this.send({
        method: "ping",
        serverAlias: "",
      });
      return res.result === "pong";
    } catch {
      return false;
    }
  }

  async flush(alias?: string): Promise<void> {
    await this.send({
      method: "flush",
      serverAlias: alias ?? "",
    });
  }

  async shutdown(): Promise<void> {
    try {
      await this.send({
        method: "shutdown",
        serverAlias: "",
      });
    } catch { /* daemon may exit before responding */ }
  }

  close() {
    this.socket?.end();
    this.socket = null;
  }
}
