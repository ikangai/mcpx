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

  async connect(config: ServerConfig): Promise<void> {
    this.transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: { ...process.env as Record<string, string>, ...config.env },
    });
    await this.client.connect(this.transport);
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

  async callTool(name: string, args: Record<string, unknown>) {
    return await this.client.callTool({ name, arguments: args });
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
