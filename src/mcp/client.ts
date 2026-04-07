import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ServerConfig } from "./config.js";

export class McpClient {
  private client: Client;
  private transport: StdioClientTransport | null = null;

  constructor() {
    this.client = new Client({ name: "mcpx", version: "0.1.0" });
  }

  async connect(config: ServerConfig, options?: { verbose?: boolean; timeout?: number }): Promise<void> {
    this.transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: { ...process.env as Record<string, string>, ...config.env },
      stderr: options?.verbose ? "pipe" : "ignore",
    });

    const timeout = options?.timeout ?? 30_000;
    let timer: ReturnType<typeof setTimeout>;
    const connectPromise = this.client.connect(this.transport);
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
