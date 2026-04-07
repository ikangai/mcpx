import { Command } from "commander";
import { McpClient } from "../mcp/client.js";
import { parseServerSpec, parseConfigFile, type ServerConfig } from "../mcp/config.js";
import { addToolFlags, parseToolArgs } from "./flags.js";
import type { JsonSchema } from "../utils/schema.js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { addServer, removeServer, getServer, getAllServers, importServers } from "../config/store.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  type Envelope,
  successTools,
  successResult,
  successSchema,
  successServers,
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
  opts?: { verbose?: boolean; timeout?: number }
): Promise<T> {
  const client = new McpClient();
  try {
    await client.connect(config, { verbose: opts?.verbose, timeout: opts?.timeout });
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
  timeout?: string;
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
        const helpSchema = tool.inputSchema as JsonSchema;
        const helpProps = helpSchema.properties ?? {};
        const helpRequired = new Set((helpSchema.required ?? []) as string[]);
        const lines = [
          `${tool.name} — ${tool.description ?? ""}`,
          "",
          "Parameters:",
        ];
        for (const [name, prop] of Object.entries(helpProps)) {
          const p = prop as { type?: string; description?: string; default?: unknown; enum?: string[] };
          const req = helpRequired.has(name) ? " (required)" : "";
          const def = p.default !== undefined ? ` [default: ${JSON.stringify(p.default)}]` : "";
          const choices = p.enum ? ` [choices: ${p.enum.join(", ")}]` : "";
          lines.push(`  --${name} <${p.type ?? "any"}>${req}${def}${choices}`);
          if (p.description) lines.push(`      ${p.description}`);
        }
        lines.push("", "  --params <json>   Pass all arguments as JSON");
        lines.push("  --dry-run         Preview without executing");
        return successResult([{ type: "text", text: lines.join("\n") }]);
      }

      // Validate required fields before calling server
      const schema = tool.inputSchema as JsonSchema;
      const required = ((schema.required ?? []) as string[]);
      const missing = required.filter((name) => !(name in args) || args[name] === undefined);
      if (missing.length > 0) {
        const props = schema.properties ?? {};
        const details = missing.map((name) => {
          const prop = props[name] as { type?: string; description?: string } | undefined;
          return `${name} (${prop?.type ?? "any"})`;
        });
        return errorEnvelope(EXIT.VALIDATION_ERROR, `Missing required field${missing.length > 1 ? "s" : ""}: ${details.join(", ")}`);
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
    }, { verbose: opts?.verbose, timeout: opts?.timeout ? Number(opts.timeout) : undefined });
  } catch (err) {
    return errorEnvelope(EXIT.CONNECTION_ERROR, (err as Error).message);
  }
}

export async function listTools(opts: ServerOpts): Promise<Envelope> {
  // If no server specified, list tools from all configured servers
  if (!opts.server && !opts.config && !opts.serverAlias) {
    return listAllServers(opts);
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
    }, { verbose: opts?.verbose, timeout: opts?.timeout ? Number(opts.timeout) : undefined });
  } catch (err) {
    return errorEnvelope(EXIT.CONNECTION_ERROR, (err as Error).message);
  }
}

async function listAllServers(opts?: ServerOpts): Promise<Envelope> {
  const servers = getAllServers();
  if (Object.keys(servers).length === 0) {
    return successTools([]);
  }

  const entries = Object.entries(servers);
  const results = await Promise.allSettled(
    entries.map(async ([alias, config]) => {
      return await withServer(config, async (_client, tools) => {
        return tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema as Record<string, unknown>,
          server: alias,
        }));
      }, { verbose: opts?.verbose, timeout: opts?.timeout ? Number(opts.timeout) : undefined });
    })
  );

  const allTools: ToolInfo[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") allTools.push(...r.value);
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
    }, { verbose: opts?.verbose, timeout: opts?.timeout ? Number(opts.timeout) : undefined });
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

export async function runServers(): Promise<Envelope> {
  const servers = getAllServers();
  const list = Object.entries(servers).map(([alias, config]) => ({
    alias,
    command: config.command,
    args: config.args,
    env: config.env,
  }));
  return successServers(list);
}

export async function runRemove(alias: string): Promise<Envelope> {
  if (!removeServer(alias)) {
    return errorEnvelope(EXIT.CONFIG_ERROR, `Server "${alias}" not found.`);
  }
  return { ok: true } as Envelope;
}

export async function runImport(configPath?: string): Promise<Envelope> {
  const path = configPath ?? findClaudeConfig();
  if (!path) {
    return errorEnvelope(EXIT.CONFIG_ERROR, "No config file found. Provide a path or install Claude Desktop.");
  }
  try {
    const imported = importServers(path);
    return successResult([{
      type: "text",
      text: `Imported ${imported.length} server(s): ${imported.join(", ") || "(none new)"}`,
    }]);
  } catch (err) {
    return errorEnvelope(EXIT.CONFIG_ERROR, (err as Error).message);
  }
}

function findClaudeConfig(): string | null {
  const candidates = [
    join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json"),
    join(homedir(), ".config", "claude", "claude_desktop_config.json"),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}
