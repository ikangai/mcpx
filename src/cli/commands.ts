import { Command } from "commander";
import { McpClient } from "../mcp/client.js";
import { parseServerSpec, parseConfigFile, type ServerConfig } from "../mcp/config.js";
import { addToolFlags, parseToolArgs } from "./flags.js";
import { formatResult, formatToolList, detectFormat } from "../output/formatter.js";
import type { JsonSchema } from "../utils/schema.js";
import { readFileSync } from "node:fs";

async function resolveServerConfig(opts: {
  server?: string;
  config?: string;
  serverName?: string;
}): Promise<ServerConfig> {
  if (opts.server) {
    return parseServerSpec(opts.server);
  }
  if (opts.config) {
    const raw = readFileSync(opts.config, "utf-8");
    const config = JSON.parse(raw);
    return parseConfigFile(config, opts.serverName);
  }
  throw new Error("Specify --server (-s) or --config (-c)");
}

export async function runList(globalOpts: {
  server?: string;
  config?: string;
  serverName?: string;
  format?: string;
}): Promise<void> {
  const serverConfig = await resolveServerConfig(globalOpts);
  const client = new McpClient();

  try {
    await client.connect(serverConfig);
    const tools = await client.listTools();
    const format = detectFormat(globalOpts.format);
    console.log(formatToolList(tools, format));
  } finally {
    await client.close();
  }
}

export async function runExec(
  toolName: string,
  toolArgs: string[],
  globalOpts: {
    server?: string;
    config?: string;
    serverName?: string;
    format?: string;
    raw?: boolean;
  }
): Promise<void> {
  const serverConfig = await resolveServerConfig(globalOpts);
  const client = new McpClient();

  try {
    await client.connect(serverConfig);
    const tools = await client.listTools();
    const tool = tools.find((t) => t.name === toolName);

    if (!tool) {
      const available = tools.map((t) => t.name).join(", ");
      console.error(`Tool "${toolName}" not found. Available: ${available}`);
      process.exit(1);
    }

    // Build a temporary command to parse tool-specific flags
    const tmpCmd = new Command(toolName);
    tmpCmd.exitOverride();
    addToolFlags(tmpCmd, tool.inputSchema as JsonSchema);
    tmpCmd.parse(toolArgs, { from: "user" });

    const args = parseToolArgs(tmpCmd.opts(), tool.inputSchema as JsonSchema);
    const result = await client.callTool(toolName, args) as {
      content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
      isError?: boolean;
    };
    const format = detectFormat(globalOpts.format);

    if (globalOpts.raw) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatResult(result, format));
    }

    if (result.isError) {
      process.exit(1);
    }
  } finally {
    await client.close();
  }
}
