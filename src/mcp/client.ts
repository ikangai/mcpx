import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ServerConfig } from "./config.js";

export function resolveTransportType(config: ServerConfig): "stdio" | "sse" | "http" {
  if (config.transport) return config.transport;
  if (config.url) return "http";
  return "stdio";
}

export class McpClient {
  private client: Client;
  private transport: Transport | null = null;

  constructor() {
    this.client = new Client({ name: "mcpx", version: "0.1.0" });
  }

  async connect(config: ServerConfig, options?: { verbose?: boolean; timeout?: number }): Promise<void> {
    const transportType = resolveTransportType(config);

    if (transportType === "stdio") {
      const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
      this.transport = new StdioClientTransport({
        command: config.command!,
        args: config.args ?? [],
        env: { ...process.env as Record<string, string>, ...config.env },
        stderr: options?.verbose ? "pipe" : "ignore",
      });
    } else if (transportType === "http") {
      const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
      const requestInit: RequestInit = {};
      const headers: Record<string, string> = { ...config.headers };

      if (Object.keys(headers).length > 0) {
        requestInit.headers = headers;
      }

      const transportOpts: Record<string, unknown> = { requestInit };

      if (config.oauth) {
        const { ClientCredentialsProvider } = await import("@modelcontextprotocol/sdk/client/auth-extensions.js");
        transportOpts.authProvider = new ClientCredentialsProvider({
          clientId: config.oauth.clientId,
          clientSecret: config.oauth.clientSecret,
          scope: config.oauth.scope,
        });
      }

      this.transport = new StreamableHTTPClientTransport(
        new URL(config.url!),
        transportOpts,
      );
    } else if (transportType === "sse") {
      const { SSEClientTransport } = await import("@modelcontextprotocol/sdk/client/sse.js");
      const requestInit: RequestInit = {};
      const headers: Record<string, string> = { ...config.headers };

      if (Object.keys(headers).length > 0) {
        requestInit.headers = headers;
      }

      const transportOpts: Record<string, unknown> = { requestInit };

      if (config.oauth) {
        const { ClientCredentialsProvider } = await import("@modelcontextprotocol/sdk/client/auth-extensions.js");
        transportOpts.authProvider = new ClientCredentialsProvider({
          clientId: config.oauth.clientId,
          clientSecret: config.oauth.clientSecret,
          scope: config.oauth.scope,
        });
      }

      this.transport = new SSEClientTransport(
        new URL(config.url!),
        transportOpts,
      );
    }

    const timeout = options?.timeout ?? 30_000;
    let timer: ReturnType<typeof setTimeout>;
    const connectPromise = this.client.connect(this.transport!);
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Connection timed out after ${timeout}ms`)), timeout);
    });
    try {
      await Promise.race([connectPromise, timeoutPromise]);
    } finally {
      clearTimeout(timer!);
    }
  }

  async listTools(): Promise<Tool[]> {
    const tools: Tool[] = [];
    let cursor: string | undefined;
    do {
      const result = await this.client.listTools({ cursor });
      tools.push(...result.tools);
      cursor = result.nextCursor;
    } while (cursor);
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>, options?: { onProgress?: (progress: { progress: number; total?: number; message?: string }) => void }) {
    return await this.client.callTool({ name, arguments: args }, undefined, options?.onProgress ? {
      onprogress: (progress) => options.onProgress!(progress as { progress: number; total?: number; message?: string }),
      resetTimeoutOnProgress: true,
    } : undefined);
  }

  getServerCapabilities(): Record<string, unknown> | undefined {
    return this.client.getServerCapabilities() as Record<string, unknown> | undefined;
  }

  getInstructions(): string | undefined {
    return this.client.getInstructions();
  }

  getServerVersion(): { name: string; version: string } | undefined {
    return this.client.getServerVersion() as { name: string; version: string } | undefined;
  }

  async listPrompts(): Promise<Array<{ name: string; description?: string }>> {
    try {
      const result = await this.client.listPrompts({});
      return result.prompts;
    } catch {
      return []; // Server doesn't support prompts
    }
  }

  async getPrompt(name: string, args?: Record<string, string>): Promise<unknown> {
    return await this.client.getPrompt({ name, arguments: args });
  }

  async listResources(): Promise<Array<{ uri: string; name?: string; description?: string; mimeType?: string }>> {
    try {
      const result = await this.client.listResources({});
      return result.resources;
    } catch {
      return []; // Server doesn't support resources
    }
  }

  async readResource(uri: string): Promise<unknown> {
    return await this.client.readResource({ uri });
  }

  async complete(ref: { type: string; name?: string; uri?: string }, argName: string, value: string): Promise<string[]> {
    try {
      const result = await this.client.complete({
        ref: ref as any,
        argument: { name: argName, value },
      });
      return result.completion.values;
    } catch {
      return []; // Server doesn't support completions
    }
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
