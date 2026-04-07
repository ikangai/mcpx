import { Command } from "commander";
import { McpClient } from "../mcp/client.js";
import { parseServerSpec, parseConfigFile, type ServerConfig } from "../mcp/config.js";
import { addToolFlags, parseToolArgs } from "./flags.js";
import type { JsonSchema } from "../utils/schema.js";
import { readFileSync } from "node:fs";
import { addServer, getServer, getAllServers } from "../config/store.js";
import {
  type Envelope,
  successTools,
  successResult,
  successSchema,
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

/**
 * Extract --params or --json value from args array.
 * Returns the JSON string or null if neither flag is present.
 * --params takes precedence.
 */
function extractParams(args: string[]): string | null {
  for (const flag of ["--params", "--json"]) {
    const idx = args.indexOf(flag);
    if (idx !== -1 && idx + 1 < args.length) {
      return args[idx + 1];
    }
  }
  return null;
}

export async function runSlashExec(
  serverAlias: string,
  toolName: string,
  toolArgs: string[]
): Promise<Envelope> {
  const serverConfig = getServer(serverAlias);
  if (!serverConfig) {
    const available = Object.keys(getAllServers()).join(", ");
    return errorEnvelope(
      EXIT.CONFIG_ERROR,
      `Server "${serverAlias}" not found. Available: ${available || "(none)"}`
    );
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
        `Tool "${toolName}" not found on server "${serverAlias}". Available: ${available}`
      );
    }

    // Parse --params / --json if present, otherwise fall back to per-field flags
    const params = extractParams(toolArgs);
    let args: Record<string, unknown>;

    if (params !== null) {
      try {
        args = JSON.parse(params);
      } catch {
        return errorEnvelope(EXIT.VALIDATION_ERROR, "Invalid JSON in --params/--json");
      }
    } else {
      // Filter out --dry-run from tool args before passing to commander
      const filteredArgs = toolArgs.filter((a) => a !== "--dry-run");
      const tmpCmd = new Command(toolName);
      tmpCmd.exitOverride();
      addToolFlags(tmpCmd, tool.inputSchema as JsonSchema);
      try {
        tmpCmd.parse(filteredArgs, { from: "user" });
      } catch (err) {
        return errorEnvelope(EXIT.VALIDATION_ERROR, (err as Error).message);
      }
      args = parseToolArgs(tmpCmd.opts(), tool.inputSchema as JsonSchema);
    }

    // Check for --dry-run
    if (toolArgs.includes("--dry-run")) {
      return successResult([{
        type: "text",
        text: JSON.stringify({
          dryRun: true,
          server: serverAlias,
          tool: toolName,
          arguments: args,
        }, null, 2),
      }]);
    }

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

export async function runSlashList(serverAlias?: string): Promise<Envelope> {
  if (serverAlias) {
    const serverConfig = getServer(serverAlias);
    if (!serverConfig) {
      return errorEnvelope(
        EXIT.CONFIG_ERROR,
        `Server "${serverAlias}" not found.`
      );
    }
    const client = new McpClient();
    try {
      await client.connect(serverConfig);
      const tools = await client.listTools();
      return successTools(tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown>,
      })));
    } catch (err) {
      return errorEnvelope(EXIT.CONNECTION_ERROR, (err as Error).message);
    } finally {
      await client.close();
    }
  }

  // List all servers — connect to each and aggregate
  const servers = getAllServers();
  const names = Object.keys(servers);
  if (names.length === 0) {
    return successTools([]);
  }

  const allTools: ToolInfo[] = [];
  for (const [, config] of Object.entries(servers)) {
    const client = new McpClient();
    try {
      await client.connect(config);
      const tools = await client.listTools();
      allTools.push(...tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown>,
      })));
    } catch {
      // Skip unreachable servers
    } finally {
      await client.close();
    }
  }
  return successTools(allTools);
}

export async function runSchema(
  serverAlias: string,
  toolName: string
): Promise<Envelope> {
  const serverConfig = getServer(serverAlias);
  if (!serverConfig) {
    return errorEnvelope(EXIT.CONFIG_ERROR, `Server "${serverAlias}" not found.`);
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

    const schema = {
      ...tool.inputSchema,
      description: tool.description,
    };

    return successSchema(schema as Record<string, unknown>);
  } catch (err) {
    return errorEnvelope(EXIT.CONNECTION_ERROR, (err as Error).message);
  } finally {
    await client.close();
  }
}

export async function runAdd(alias: string, command: string): Promise<Envelope> {
  try {
    addServer(alias, command);
    return { ok: true } as Envelope;
  } catch (err) {
    return errorEnvelope(EXIT.CONFIG_ERROR, (err as Error).message);
  }
}
