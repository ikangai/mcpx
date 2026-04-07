import { Command } from "commander";
import { McpClient } from "../mcp/client.js";
import { parseServerSpec, parseConfigFile, type ServerConfig } from "../mcp/config.js";
import { addToolFlags, parseToolArgs } from "./flags.js";
import type { JsonSchema } from "../utils/schema.js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { addServer, removeServer, updateServer, getServer, getAllServers, importServers, addAlias, removeAlias, getAlias, getAllAliases, saveSnapshot, loadSnapshot } from "../config/store.js";
import { diffToolSchemas, formatDiff } from "./diff.js";
import { generateSkill } from "../skills/generator.js";
import { DaemonClient } from "../daemon/client.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  type Envelope,
  successTools,
  successResult,
  successSchema,
  successServers,
  successEmpty,
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
          } as McpClient;
          return await fn(proxyClient, tools);
        } finally {
          daemon.close();
        }
      }
    } catch {
      // Daemon not available, fall back to direct connection
    }
  }

  // Direct connection fallback
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
      const tool = tools.find((t) => t.name === toolName);
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

      // Set up progress reporting on TTY
      const showProgress = process.stderr.isTTY;
      const onProgress = showProgress ? (p: { progress: number; total?: number; message?: string }) => {
        const pct = p.total ? Math.round((p.progress / p.total) * 100) : null;
        const bar = pct !== null ? `[${pct}%] ` : "";
        process.stderr.write(`\r${bar}${p.message ?? ""}`.padEnd(60));
      } : undefined;

      const result = (await client.callTool(toolName, args, onProgress ? { onProgress } : undefined)) as {
        content: Array<ContentItem>;
        isError?: boolean;
      };

      // Clear progress line
      if (showProgress) process.stderr.write("\r" + " ".repeat(60) + "\r");

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
        return successResult(extracted);
      }

      return successResult(result.content);
    }, { verbose: opts?.verbose, timeout: opts?.timeout, serverAlias: opts?.serverAlias });
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
          annotations: (t as any).annotations,
        }))
      );
    }, { verbose: opts?.verbose, timeout: opts?.timeout, serverAlias: opts?.serverAlias });
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
    }, { verbose: opts?.verbose, timeout: opts?.timeout, serverAlias: opts?.serverAlias });
  } catch (err) {
    return errorEnvelope(EXIT.CONNECTION_ERROR, (err as Error).message);
  }
}

export async function runAdd(alias: string, command: string, env?: Record<string, string>): Promise<Envelope> {
  try {
    addServer(alias, command, env);
    return successEmpty();
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
  // Flush daemon cache for this alias
  try {
    const daemon = new DaemonClient();
    if (await daemon.tryConnect()) {
      await daemon.flush(alias);
      daemon.close();
    }
  } catch { /* ignore */ }
  return successEmpty();
}

export async function runUpdate(alias: string, opts: { command?: string; env?: Record<string, string> }): Promise<Envelope> {
  if (!updateServer(alias, opts)) {
    return errorEnvelope(EXIT.CONFIG_ERROR, `Server "${alias}" not found.`);
  }
  // Flush daemon cache for this alias
  try {
    const daemon = new DaemonClient();
    if (await daemon.tryConnect()) {
      await daemon.flush(alias);
      daemon.close();
    }
  } catch { /* ignore */ }
  return successEmpty();
}

export async function runImport(configPath?: string, force = false): Promise<Envelope> {
  const path = configPath ?? findClaudeConfig();
  if (!path) {
    return errorEnvelope(EXIT.CONFIG_ERROR, "No config file found. Provide a path or install Claude Desktop.");
  }
  try {
    const imported = importServers(path, force);
    return successResult([{
      type: "text",
      text: `Imported ${imported.length} server(s): ${imported.join(", ") || "(none new)"}`,
    }]);
  } catch (err) {
    return errorEnvelope(EXIT.CONFIG_ERROR, (err as Error).message);
  }
}

export async function runSkills(serverAlias: string, opts?: ServerOpts): Promise<Envelope> {
  let serverConfig: ServerConfig;
  try {
    serverConfig = resolveServer({ serverAlias });
  } catch (err) {
    if (err instanceof ConfigError) return errorEnvelope(EXIT.CONFIG_ERROR, err.message);
    return errorEnvelope(EXIT.INTERNAL_ERROR, (err as Error).message);
  }

  try {
    return await withServer(serverConfig, async (_client, tools) => {
      const skill = generateSkill(serverAlias, tools);
      return successResult([{ type: "text", text: skill }]);
    }, { verbose: opts?.verbose, timeout: opts?.timeout, serverAlias });
  } catch (err) {
    return errorEnvelope(EXIT.CONNECTION_ERROR, (err as Error).message);
  }
}

export async function runListPrompts(opts: ServerOpts): Promise<Envelope> {
  let serverConfig: ServerConfig;
  try { serverConfig = resolveServer(opts); }
  catch (err) {
    if (err instanceof ConfigError) return errorEnvelope(EXIT.CONFIG_ERROR, err.message);
    return errorEnvelope(EXIT.INTERNAL_ERROR, (err as Error).message);
  }

  const client = new McpClient();
  try {
    await client.connect(serverConfig, { verbose: opts?.verbose, timeout: opts?.timeout });
    const prompts = await client.listPrompts();
    return successResult([{ type: "text", text: JSON.stringify(prompts, null, 2) }]);
  } catch (err) {
    return errorEnvelope(EXIT.CONNECTION_ERROR, (err as Error).message);
  } finally {
    await client.close();
  }
}

export async function runGetPrompt(
  promptName: string,
  promptArgs: Record<string, string>,
  opts: ServerOpts
): Promise<Envelope> {
  let serverConfig: ServerConfig;
  try { serverConfig = resolveServer(opts); }
  catch (err) {
    if (err instanceof ConfigError) return errorEnvelope(EXIT.CONFIG_ERROR, err.message);
    return errorEnvelope(EXIT.INTERNAL_ERROR, (err as Error).message);
  }

  const client = new McpClient();
  try {
    await client.connect(serverConfig, { verbose: opts?.verbose, timeout: opts?.timeout });
    const result = await client.getPrompt(promptName, promptArgs);
    return successResult([{ type: "text", text: JSON.stringify(result, null, 2) }]);
  } catch (err) {
    return errorEnvelope(EXIT.CONNECTION_ERROR, (err as Error).message);
  } finally {
    await client.close();
  }
}

export async function runInspect(opts: ServerOpts): Promise<Envelope> {
  let serverConfig: ServerConfig;
  try {
    serverConfig = resolveServer(opts);
  } catch (err) {
    if (err instanceof ConfigError) return errorEnvelope(EXIT.CONFIG_ERROR, err.message);
    return errorEnvelope(EXIT.INTERNAL_ERROR, (err as Error).message);
  }

  const client = new McpClient();
  try {
    await client.connect(serverConfig, { verbose: opts?.verbose, timeout: opts?.timeout });
    const tools = await client.listTools();
    const prompts = await client.listPrompts();
    const resources = await client.listResources();
    const capabilities = client.getServerCapabilities();
    const version = client.getServerVersion();
    const instructions = client.getInstructions();

    const info: Record<string, unknown> = {
      name: version?.name,
      version: version?.version,
      capabilities: capabilities ?? {},
      instructions: instructions ?? null,
      tools: tools.length,
      prompts: prompts.length,
      resources: resources.length,
    };

    // Include tool annotations summary
    const annotated = tools.filter((t: any) => t.annotations);
    if (annotated.length > 0) {
      info.annotatedTools = annotated.map((t: any) => ({
        name: t.name,
        annotations: t.annotations,
      }));
    }

    return successResult([{ type: "text", text: JSON.stringify(info, null, 2) }]);
  } catch (err) {
    return errorEnvelope(EXIT.CONNECTION_ERROR, (err as Error).message);
  } finally {
    await client.close();
  }
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

export async function runListResources(opts: ServerOpts): Promise<Envelope> {
  let serverConfig: ServerConfig;
  try { serverConfig = resolveServer(opts); }
  catch (err) {
    if (err instanceof ConfigError) return errorEnvelope(EXIT.CONFIG_ERROR, err.message);
    return errorEnvelope(EXIT.INTERNAL_ERROR, (err as Error).message);
  }

  const client = new McpClient();
  try {
    await client.connect(serverConfig, { verbose: opts?.verbose, timeout: opts?.timeout });
    const resources = await client.listResources();
    return successResult([{ type: "text", text: JSON.stringify(resources, null, 2) }]);
  } catch (err) {
    return errorEnvelope(EXIT.CONNECTION_ERROR, (err as Error).message);
  } finally {
    await client.close();
  }
}

export async function runReadResource(uri: string, opts: ServerOpts): Promise<Envelope> {
  let serverConfig: ServerConfig;
  try { serverConfig = resolveServer(opts); }
  catch (err) {
    if (err instanceof ConfigError) return errorEnvelope(EXIT.CONFIG_ERROR, err.message);
    return errorEnvelope(EXIT.INTERNAL_ERROR, (err as Error).message);
  }

  const client = new McpClient();
  try {
    await client.connect(serverConfig, { verbose: opts?.verbose, timeout: opts?.timeout });
    const resource = await client.readResource(uri);
    return successResult([{ type: "text", text: JSON.stringify(resource, null, 2) }]);
  } catch (err) {
    return errorEnvelope(EXIT.CONNECTION_ERROR, (err as Error).message);
  } finally {
    await client.close();
  }
}

// ---------------------------------------------------------------------------
// Aliases
// ---------------------------------------------------------------------------

export async function runAlias(action: string, name?: string, command?: string): Promise<Envelope> {
  if (action === "list") {
    const aliases = getAllAliases();
    return successResult([{ type: "text", text: JSON.stringify(aliases, null, 2) }]);
  }
  if (action === "set" && name && command) {
    addAlias(name, command);
    return successEmpty();
  }
  if (action === "remove" && name) {
    if (!removeAlias(name)) {
      return errorEnvelope(EXIT.CONFIG_ERROR, `Alias "${name}" not found.`);
    }
    return successEmpty();
  }
  return errorEnvelope(EXIT.VALIDATION_ERROR, "Usage: mcpx alias list | mcpx alias set <name> <command> | mcpx alias remove <name>");
}

export async function runAliasExec(name: string, extraArgs: string[], opts: ServerOpts): Promise<Envelope> {
  const command = getAlias(name);
  if (!command) {
    return errorEnvelope(EXIT.CONFIG_ERROR, `Alias "${name}" not found.`);
  }
  const { parsePShorthand } = await import("./router.js");
  const parsed = parsePShorthand(command);
  if (!parsed) {
    return errorEnvelope(EXIT.VALIDATION_ERROR, `Invalid alias format: ${command}`);
  }
  const mergedArgs = [...parsed.toolArgs, ...extraArgs];
  return invokeTool(parsed.toolName, mergedArgs, { ...opts, serverAlias: parsed.serverAlias });
}

// ---------------------------------------------------------------------------
// Schema Diff
// ---------------------------------------------------------------------------

export async function runDiff(serverAlias: string, opts: ServerOpts): Promise<Envelope> {
  let serverConfig: ServerConfig;
  try { serverConfig = resolveServer({ serverAlias }); }
  catch (err) {
    if (err instanceof ConfigError) return errorEnvelope(EXIT.CONFIG_ERROR, err.message);
    return errorEnvelope(EXIT.INTERNAL_ERROR, (err as Error).message);
  }

  const client = new McpClient();
  try {
    await client.connect(serverConfig, { verbose: opts?.verbose, timeout: opts?.timeout });
    const currentTools = await client.listTools();
    const current = currentTools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown>,
    }));

    const previous = loadSnapshot(serverAlias);

    // Save current as new snapshot
    saveSnapshot(serverAlias, current);

    if (!previous) {
      return successResult([{
        type: "text",
        text: `Snapshot saved for ${serverAlias} (${current.length} tools). No previous snapshot to compare.`,
      }]);
    }

    const diff = diffToolSchemas(previous, current);
    const text = formatDiff(diff);
    return successResult([{ type: "text", text }]);
  } catch (err) {
    return errorEnvelope(EXIT.CONNECTION_ERROR, (err as Error).message);
  } finally {
    await client.close();
  }
}

function findClaudeConfig(): string | null {
  const candidates = [
    join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json"),
    join(homedir(), ".config", "claude", "claude_desktop_config.json"),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}
