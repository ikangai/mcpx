import { Command } from "commander";
import { McpClient } from "../mcp/client.js";
import { parseServerSpec, parseConfigFile, type ServerConfig } from "../mcp/config.js";
import { addToolFlags, parseToolArgs } from "./flags.js";
import type { JsonSchema } from "../utils/schema.js";
import { readFileSync } from "node:fs";
import { addServer, getServer, getAllServers } from "../config/store.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class ConfigError extends Error {}

function resolveServer(opts: {
  server?: string;
  config?: string;
  serverName?: string;
  serverAlias?: string;
}): ServerConfig {
  if (opts.serverAlias) {
    const config = getServer(opts.serverAlias);
    if (!config) {
      const available = Object.keys(getAllServers()).join(", ");
      throw new ConfigError(
        `Server "${opts.serverAlias}" not found. Available: ${available || "(none)"}`
      );
    }
    return config;
  }
  if (opts.server) return parseServerSpec(opts.server);
  if (opts.config) {
    const raw = readFileSync(opts.config, "utf-8");
    return parseConfigFile(JSON.parse(raw), opts.serverName);
  }
  throw new ConfigError("Specify a server: /alias, --server, or --config");
}

async function withServer<T>(
  config: ServerConfig,
  fn: (client: McpClient, tools: Tool[]) => Promise<T>,
  opts?: { verbose?: boolean }
): Promise<T> {
  const client = new McpClient();
  try {
    await client.connect(config, { verbose: opts?.verbose });
    const tools = await client.listTools();
    return await fn(client, tools);
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

type ServerOpts = {
  server?: string;
  config?: string;
  serverName?: string;
  serverAlias?: string;
  verbose?: boolean;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function invokeTool(
  toolName: string,
  toolArgs: string[],
  opts: ServerOpts
): Promise<Envelope> {
  let serverConfig: ServerConfig;
  try {
    serverConfig = resolveServer(opts);
  } catch (err) {
    if (err instanceof ConfigError) {
      return errorEnvelope(EXIT.CONFIG_ERROR, err.message);
    }
    return errorEnvelope(EXIT.INTERNAL_ERROR, (err as Error).message);
  }

  const serverLabel = opts.serverAlias ?? "server";

  try {
    return await withServer(serverConfig, async (client, tools) => {
      const tool = tools.find((t) => t.name === toolName);
      if (!tool) {
        const available = tools.map((t) => t.name).join(", ");
        return errorEnvelope(
          EXIT.VALIDATION_ERROR,
          `Tool "${toolName}" not found on ${serverLabel}. Available: ${available}`
        );
      }

      // Parse args: --params/--json takes precedence, then per-field flags
      const params = extractParams(toolArgs);
      let args: Record<string, unknown>;

      if (params !== null) {
        try {
          args = JSON.parse(params);
        } catch {
          return errorEnvelope(EXIT.VALIDATION_ERROR, "Invalid JSON in --params/--json");
        }
      } else {
        const filteredArgs = toolArgs.filter(
          (a) => a !== "--dry-run" && a !== "--help"
        );
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

      // --help: show schema as usage
      if (toolArgs.includes("--help")) {
        return successSchema({
          ...tool.inputSchema,
          description: tool.description,
        } as Record<string, unknown>);
      }

      // --dry-run: preview without executing
      if (toolArgs.includes("--dry-run")) {
        return successResult([
          {
            type: "text",
            text: JSON.stringify(
              {
                dryRun: true,
                server: serverLabel,
                tool: toolName,
                arguments: args,
              },
              null,
              2
            ),
          },
        ]);
      }

      const result = (await client.callTool(toolName, args)) as {
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
    }, { verbose: opts?.verbose });
  } catch (err) {
    return errorEnvelope(EXIT.CONNECTION_ERROR, (err as Error).message);
  }
}

export async function listTools(opts: ServerOpts): Promise<Envelope> {
  // If no server specified, list tools from all configured servers
  if (!opts.server && !opts.config && !opts.serverAlias) {
    return listAllServers();
  }

  let serverConfig: ServerConfig;
  try {
    serverConfig = resolveServer(opts);
  } catch (err) {
    if (err instanceof ConfigError) {
      return errorEnvelope(EXIT.CONFIG_ERROR, err.message);
    }
    return errorEnvelope(EXIT.INTERNAL_ERROR, (err as Error).message);
  }

  try {
    return await withServer(serverConfig, async (_client, tools) => {
      return successTools(
        tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema as Record<string, unknown>,
          server: opts.serverAlias,
        }))
      );
    }, { verbose: opts?.verbose });
  } catch (err) {
    return errorEnvelope(EXIT.CONNECTION_ERROR, (err as Error).message);
  }
}

async function listAllServers(): Promise<Envelope> {
  const servers = getAllServers();
  if (Object.keys(servers).length === 0) {
    return successTools([]);
  }

  const allTools: ToolInfo[] = [];
  for (const [alias, config] of Object.entries(servers)) {
    try {
      await withServer(config, async (_client, tools) => {
        allTools.push(
          ...tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema as Record<string, unknown>,
            server: alias,
          }))
        );
      });
    } catch {
      // Skip unreachable servers
    }
  }
  return successTools(allTools);
}

export async function getToolSchema(
  toolName: string,
  opts: ServerOpts
): Promise<Envelope> {
  let serverConfig: ServerConfig;
  try {
    serverConfig = resolveServer(opts);
  } catch (err) {
    if (err instanceof ConfigError) {
      return errorEnvelope(EXIT.CONFIG_ERROR, err.message);
    }
    return errorEnvelope(EXIT.INTERNAL_ERROR, (err as Error).message);
  }

  try {
    return await withServer(serverConfig, async (_client, tools) => {
      const tool = tools.find((t) => t.name === toolName);
      if (!tool) {
        const available = tools.map((t) => t.name).join(", ");
        return errorEnvelope(
          EXIT.VALIDATION_ERROR,
          `Tool "${toolName}" not found. Available: ${available}`
        );
      }
      return successSchema({
        ...tool.inputSchema,
        description: tool.description,
      } as Record<string, unknown>);
    }, { verbose: opts?.verbose });
  } catch (err) {
    return errorEnvelope(EXIT.CONNECTION_ERROR, (err as Error).message);
  }
}

export async function runAdd(alias: string, command: string, env?: Record<string, string>): Promise<Envelope> {
  try {
    addServer(alias, command, env);
    return { ok: true } as Envelope;
  } catch (err) {
    return errorEnvelope(EXIT.CONFIG_ERROR, (err as Error).message);
  }
}
