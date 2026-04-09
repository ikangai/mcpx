import { Command } from "commander";
// McpClient type is imported for signatures (erased at compile time).
// The actual class is lazy-imported only when daemon is unavailable,
// avoiding the 59ms MCP SDK load on the hot path.
import type { McpClient } from "../mcp/client.js";
import { parseServerSpec, parseConfigFile, type ServerConfig } from "../mcp/config.js";
import { addToolFlags, parseToolArgs } from "./flags.js";
import type { JsonSchema } from "../utils/schema.js";
import { readFileSync } from "node:fs";
import { getServer, getAllServers } from "../config/store.js";
import { logInvocation } from "../audit/logger.js";
import { runHooks } from "../hooks/runner.js";
import { DaemonClient } from "../daemon/client.js";
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

export class ConfigError extends Error {}

export function resolveServer(opts: {
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
  opts?: { verbose?: boolean; timeout?: number; serverAlias?: string }
): Promise<T> {
  // Try daemon for cached connections when a server alias is available
  if (opts?.serverAlias) {
    try {
      const daemon = new DaemonClient();
      if (await daemon.tryConnect()) {
        try {
          const tools = await daemon.listTools(opts.serverAlias, config);
          const proxyClient = {
            callTool: async (name: string, args: Record<string, unknown>) => {
              return daemon.callTool(opts.serverAlias!, config, name, args);
            },
          } as unknown as McpClient;
          return await fn(proxyClient, tools);
        } finally {
          daemon.close();
        }
      }
    } catch {
      // Daemon not available, fall back to direct connection
    }
  }

  // Direct connection fallback — lazy-import MCP SDK (59ms savings on daemon path)
  const { McpClient: McpClientClass } = await import("../mcp/client.js");
  const client = new McpClientClass();
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

export function friendlyError(err: Error, serverConfig?: ServerConfig): string {
  const msg = err.message;
  if (msg.includes("ENOENT") || msg.includes("spawn")) {
    const cmd = serverConfig?.command ?? "the command";
    return `Command "${cmd}" not found. Is it installed and in your PATH?`;
  }
  if (msg.includes("ECONNREFUSED")) return "Connection refused. Is the server running?";
  if (msg.includes("timed out")) return "Connection timed out. Try increasing --timeout.";
  if (msg.includes("EACCES")) return "Permission denied. Check file permissions.";
  if (msg.includes("401") || msg.includes("Unauthorized")) return "Authentication failed. Check your token or OAuth credentials.";
  if (msg.includes("403") || msg.includes("Forbidden")) return "Access denied. Check your permissions.";
  if (msg.includes("fetch failed") || msg.includes("ENOTFOUND")) return "Could not reach server. Check the URL.";
  return msg;
}

export type ServerOpts = {
  server?: string;
  config?: string;
  serverName?: string;
  serverAlias?: string;
  verbose?: boolean;
  timeout?: number;
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
      // Map lookup for consistency with daemon path (daemon stores persistent toolIndex)
      const toolIndex = new Map(tools.map(t => [t.name, t]));
      const tool = toolIndex.get(toolName);
      if (!tool) {
        const available = tools.map((t) => t.name).join(", ");
        return errorEnvelope(
          EXIT.VALIDATION_ERROR,
          `Tool "${toolName}" not found on ${serverLabel}. Available: ${available}`
        );
      }

      // Parse args: --params-stdin > --params/--json > per-field flags
      let args: Record<string, unknown>;

      if (toolArgs.includes("--params-stdin")) {
        try {
          const stdinData = readFileSync(0, "utf-8").trim();
          try {
            const parsed = JSON.parse(stdinData);
            // Auto-unwrap envelope: if it's an mcpx envelope with result text, extract the text
            if (parsed.ok === true && Array.isArray(parsed.result) && parsed.result[0]?.text) {
              try { args = JSON.parse(parsed.result[0].text); }
              catch { args = parsed; }
            } else {
              args = parsed;
            }
          } catch {
            return errorEnvelope(EXIT.VALIDATION_ERROR, "Invalid JSON from stdin");
          }
        } catch {
          return errorEnvelope(EXIT.VALIDATION_ERROR, "Failed to read from stdin");
        }
      } else {
        const params = extractParams(toolArgs);
        if (params !== null) {
          try {
            args = JSON.parse(params);
          } catch {
            return errorEnvelope(EXIT.VALIDATION_ERROR, "Invalid JSON in --params/--json");
          }
        } else {
          // Filter out meta flags before parsing tool flags
          const filteredArgs = toolArgs.filter((a, i) => {
            if (a === "--dry-run" || a === "--help") return false;
            if (a === "--field") return false;
            // Also skip the value after --field
            if (i > 0 && toolArgs[i - 1] === "--field") return false;
            return true;
          });
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
        lines.push("", "  --params <json>     Pass all arguments as JSON");
        lines.push("  --params-stdin      Read arguments as JSON from stdin");
        lines.push("  --field <name>      Extract a field from JSON result");
        lines.push("  --dry-run           Preview without executing");

        // Show tool annotations if present
        const annotations = (tool as any).annotations as {
          title?: string;
          readOnlyHint?: boolean;
          destructiveHint?: boolean;
          idempotentHint?: boolean;
          openWorldHint?: boolean;
        } | undefined;
        if (annotations) {
          const hints: string[] = [];
          if (annotations.destructiveHint) hints.push("destructive");
          if (annotations.readOnlyHint) hints.push("read-only");
          if (annotations.idempotentHint) hints.push("idempotent");
          if (annotations.openWorldHint) hints.push("open-world");
          if (hints.length > 0) lines.push("", `Hints: ${hints.join(", ")}`);
        }

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

      // Run before hooks
      if (opts.serverAlias) {
        runHooks("before", opts.serverAlias, toolName, { MCPX_PARAMS: JSON.stringify(args) });
      }

      // Set up progress reporting on TTY
      const showProgress = process.stderr.isTTY;
      const onProgress = showProgress ? (p: { progress: number; total?: number; message?: string }) => {
        const pct = p.total ? Math.round((p.progress / p.total) * 100) : null;
        const bar = pct !== null ? `[${pct}%] ` : "";
        process.stderr.write(`\r${bar}${p.message ?? ""}`.padEnd(60));
      } : undefined;

      const callStart = performance.now();
      const result = (await client.callTool(toolName, args, onProgress ? { onProgress } : undefined)) as {
        content: Array<ContentItem>;
        isError?: boolean;
      };
      const durationMs = Math.round(performance.now() - callStart);

      // Clear progress line
      if (showProgress) process.stderr.write("\r" + " ".repeat(60) + "\r");

      // Run after hooks
      if (opts.serverAlias) {
        runHooks("after", opts.serverAlias, toolName, {
          MCPX_PARAMS: JSON.stringify(args),
          MCPX_RESULT: JSON.stringify(result),
        });
      }

      // Audit log
      logInvocation({
        server: serverLabel,
        tool: toolName,
        params: args,
        exitCode: result.isError ? 1 : 0,
        durationMs,
      });

      if (result.isError) {
        const msg = result.content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("\n");
        return errorEnvelope(EXIT.TOOL_ERROR, msg || "Tool returned an error");
      }

      // --field: extract a specific field from JSON result
      const fieldIdx = toolArgs.indexOf("--field");
      if (fieldIdx !== -1 && fieldIdx + 1 < toolArgs.length) {
        const fieldName = toolArgs[fieldIdx + 1];
        const extracted: ContentItem[] = result.content.map((c) => {
          if (c.type === "text" && c.text) {
            try {
              const parsed = JSON.parse(c.text);
              if (fieldName in parsed) {
                return { type: "text", text: String(parsed[fieldName]) };
              }
            } catch { /* not JSON */ }
          }
          return c;
        });
        const env = successResult(extracted);
        // Tag for auto-raw in pipe mode
        (env as any)._fieldExtracted = true;
        return env;
      }

      return successResult(result.content);
    }, { verbose: opts?.verbose, timeout: opts?.timeout, serverAlias: opts?.serverAlias });
  } catch (err) {
    const msg = (err as Error).message;
    const isTimeout = msg.includes("timed out") || msg.includes("timeout") || msg.includes("ETIMEDOUT");
    const code = isTimeout ? EXIT.TIMEOUT : EXIT.CONNECTION_ERROR;
    return errorEnvelope(code, friendlyError(err as Error, serverConfig));
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
          annotations: (t as any).annotations,
        }))
      );
    }, { verbose: opts?.verbose, timeout: opts?.timeout, serverAlias: opts?.serverAlias });
  } catch (err) {
    return errorEnvelope(EXIT.CONNECTION_ERROR, friendlyError(err as Error, serverConfig));
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
          annotations: (t as any).annotations,
        }));
      }, { verbose: opts?.verbose, timeout: opts?.timeout, serverAlias: alias });
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
      const toolIndex = new Map(tools.map(t => [t.name, t]));
      const tool = toolIndex.get(toolName);
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
    }, { verbose: opts?.verbose, timeout: opts?.timeout, serverAlias: opts?.serverAlias });
  } catch (err) {
    return errorEnvelope(EXIT.CONNECTION_ERROR, friendlyError(err as Error, serverConfig));
  }
}
