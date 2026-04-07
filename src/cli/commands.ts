import { Command } from "commander";
import { McpClient } from "../mcp/client.js";
import { parseServerSpec, parseConfigFile, type ServerConfig } from "../mcp/config.js";
import { addToolFlags, parseToolArgs } from "./flags.js";
import type { JsonSchema } from "../utils/schema.js";
import { readFileSync } from "node:fs";
import {
  type Envelope,
  successTools,
  successResult,
  errorEnvelope,
  EXIT,
  type ContentItem,
  type ToolInfo,
} from "../output/envelope.js";

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
}): Promise<Envelope> {
  let serverConfig;
  try {
    serverConfig = await resolveServerConfig(globalOpts);
  } catch (err) {
    return errorEnvelope(EXIT.CONFIG_ERROR, (err as Error).message);
  }

  const client = new McpClient();
  try {
    await client.connect(serverConfig);
    const tools = await client.listTools();
    const toolInfos: ToolInfo[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown>,
    }));
    return successTools(toolInfos);
  } catch (err) {
    return errorEnvelope(EXIT.CONNECTION_ERROR, (err as Error).message);
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
  }
): Promise<Envelope> {
  let serverConfig;
  try {
    serverConfig = await resolveServerConfig(globalOpts);
  } catch (err) {
    return errorEnvelope(EXIT.CONFIG_ERROR, (err as Error).message);
  }

  const client = new McpClient();
  try {
    await client.connect(serverConfig);
    const tools = await client.listTools();
    const tool = tools.find((t) => t.name === toolName);

    if (!tool) {
      const available = tools.map((t) => t.name).join(", ");
      return errorEnvelope(
        EXIT.VALIDATION_ERROR,
        `Tool "${toolName}" not found. Available: ${available}`
      );
    }

    const tmpCmd = new Command(toolName);
    tmpCmd.exitOverride();
    addToolFlags(tmpCmd, tool.inputSchema as JsonSchema);

    try {
      tmpCmd.parse(toolArgs, { from: "user" });
    } catch (err) {
      return errorEnvelope(EXIT.VALIDATION_ERROR, (err as Error).message);
    }

    const args = parseToolArgs(tmpCmd.opts(), tool.inputSchema as JsonSchema);
    const result = await client.callTool(toolName, args) as {
      content: Array<ContentItem>;
      isError?: boolean;
    };

    if (result.isError) {
      const msg = result.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      return errorEnvelope(EXIT.TOOL_ERROR, msg || "Tool returned an error");
    }

    return successResult(result.content);
  } catch (err) {
    return errorEnvelope(EXIT.CONNECTION_ERROR, (err as Error).message);
  } finally {
    await client.close();
  }
}
