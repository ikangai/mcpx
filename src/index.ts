#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";

// Early arg scanning for --config-dir (must be set before any imports read it)
const configDirIdx = process.argv.indexOf("--config-dir");
if (configDirIdx !== -1 && configDirIdx + 1 < process.argv.length) {
  process.env.MCPX_CONFIG_DIR = process.argv[configDirIdx + 1];
}

// Load .env file from cwd (before any other imports read env)
(function loadDotEnv() {
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
})();

import { Command } from "commander";
import { invokeTool, listTools, runAdd, runUpdate, runServers, runRemove, getToolSchema, runImport, runSkills, runInspect, runListPrompts, runGetPrompt, runAlias, runAliasExec } from "./cli/commands.js";
import { parseSlashCommand, parsePShorthand, GLOBAL_VALUE_FLAGS } from "./cli/router.js";
import { runInteractive } from "./interactive/repl.js";
import { output, errorEnvelope, successResult, EXIT, type Envelope } from "./output/envelope.js";
import { formatResult, formatToolList, detectFormat, type Format } from "./output/formatter.js";
import { generateBashCompletion, generateZshCompletion } from "./cli/completion.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import YAML from "yaml";
import { DaemonClient } from "./daemon/client.js";

function extractGlobalOpts(argv: string[]): { verbose?: boolean; timeout?: number; format?: string } {
  const opts: { verbose?: boolean; timeout?: number; format?: string } = {};
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--verbose" || args[i] === "-v") opts.verbose = true;
    if ((args[i] === "--timeout" || args[i] === "-t") && i + 1 < args.length) {
      opts.timeout = Number(args[i + 1]);
    }
    if ((args[i] === "--format" || args[i] === "-f") && i + 1 < args.length) {
      opts.format = args[i + 1];
    }
  }
  return opts;
}

/** Parse commander opts with timeout converted to number */
function getOpts(): import("./cli/commands.js").ServerOpts {
  const raw = program.opts();
  return {
    ...raw,
    timeout: raw.timeout ? Number(raw.timeout) : undefined,
  };
}

/**
 * Emit output in the requested format.
 * When --format is table or yaml, unwrap the envelope for human-friendly display.
 * When --format is json or omitted, emit the raw JSON envelope (agent-facing).
 */
function emitOutput(envelope: Envelope, formatOverride?: string): never {
  const fmt = formatOverride ?? program.opts().format;
  if (fmt && fmt !== "json") {
    if (!envelope.ok) {
      console.error(envelope.error.message);
      process.exit(envelope.error.code);
    }
    const resolved: Format = fmt === "auto" ? detectFormat() : fmt as Format;
    try {
      if (envelope.result) {
        console.log(formatResult({ content: envelope.result }, resolved));
      } else if (envelope.tools) {
        console.log(formatToolList(envelope.tools.map(t => ({
          name: t.name,
          description: t.description ?? "",
          inputSchema: t.inputSchema,
        })) as Tool[], resolved));
      } else if (envelope.schema) {
        console.log(fmt === "yaml" ? YAML.stringify(envelope.schema) : JSON.stringify(envelope.schema, null, 2));
      } else if (envelope.servers) {
        console.log(fmt === "yaml" ? YAML.stringify(envelope.servers) : JSON.stringify(envelope.servers, null, 2));
      } else {
        // Empty success (add, remove, update)
        console.log("OK");
      }
    } catch (err) {
      console.error(`Formatting error: ${(err as Error).message}`);
      // Fall back to JSON envelope
      console.log(JSON.stringify(envelope, null, 2));
    }
    process.exit(0);
  }
  return output(envelope);
}

const program = new Command();

program
  .name("mcpx")
  .description("Transform MCP servers into CLI commands")
  .version("0.1.0")
  .option("-s, --server <command>", "MCP server command (inline)")
  .option("-c, --config <file>", "Path to config file")
  .option("-n, --server-name <name>", "Server name from config")
  .option("-v, --verbose", "Show debug info")
  .option("-t, --timeout <ms>", "Connection timeout in milliseconds", "30000")
  .option("-f, --format <format>", "Output format: json | table | yaml")
  .option("--config-dir <path>", "Override config directory (default: ~/.config/mcpx)");

program
  .command("list [server]")
  .description("List available tools (optionally filter by /server)")
  .action(async (server?: string) => {
    const opts = getOpts();
    if (server?.startsWith("/")) {
      opts.serverAlias = server.slice(1);
    }
    const envelope = await listTools(opts);
    emitOutput(envelope);
  });

program
  .command("exec <tool>")
  .description("Execute an MCP tool")
  .allowUnknownOption()
  .allowExcessArguments()
  .helpOption(false)
  .action(async (toolName: string, _opts: unknown, cmd: Command) => {
    const toolArgs = cmd.args.filter((a) => a !== toolName);
    const envelope = await invokeTool(toolName, toolArgs, getOpts());
    emitOutput(envelope);
  });

program
  .command("add <alias> <command>")
  .description("Register an MCP server with a short alias")
  .option("-e, --env <KEY=VALUE...>", "Set environment variable (repeatable)")
  .action(async (alias: string, command: string, opts: { env?: string[] }) => {
    const env: Record<string, string> = {};
    for (const e of opts.env ?? []) {
      const idx = e.indexOf("=");
      if (idx > 0) env[e.slice(0, idx)] = e.slice(idx + 1);
    }
    const envelope = await runAdd(alias, command, Object.keys(env).length > 0 ? env : undefined);
    emitOutput(envelope);
  });

program
  .command("schema <server> <tool>")
  .description("Show full input schema for a tool")
  .action(async (server: string, tool: string) => {
    const alias = server.startsWith("/") ? server.slice(1) : server;
    const envelope = await getToolSchema(tool, { ...getOpts(), serverAlias: alias });
    emitOutput(envelope);
  });

program
  .command("servers")
  .description("List registered servers")
  .action(async () => {
    const envelope = await runServers();
    emitOutput(envelope);
  });

program
  .command("remove <alias>")
  .description("Remove a registered server")
  .action(async (alias: string) => {
    const envelope = await runRemove(alias);
    emitOutput(envelope);
  });

program
  .command("update <alias>")
  .description("Update a registered server's configuration")
  .option("--command <command>", "New server command")
  .option("-e, --env <KEY=VALUE...>", "Set/update environment variables")
  .action(async (alias: string, opts: { command?: string; env?: string[] }) => {
    const env: Record<string, string> = {};
    for (const e of opts.env ?? []) {
      const idx = e.indexOf("=");
      if (idx > 0) env[e.slice(0, idx)] = e.slice(idx + 1);
    }
    const envelope = await runUpdate(alias, {
      command: opts.command,
      env: Object.keys(env).length > 0 ? env : undefined,
    });
    emitOutput(envelope);
  });

program
  .command("import [config-path]")
  .description("Import servers from Claude Desktop config")
  .option("--force", "Overwrite existing server aliases")
  .action(async (configPath?: string, opts?: { force?: boolean }) => {
    const envelope = await runImport(configPath, opts?.force);
    emitOutput(envelope);
  });

program
  .command("skills <server>")
  .description("Generate agent skill documentation for a server")
  .action(async (server: string) => {
    const alias = server.startsWith("/") ? server.slice(1) : server;
    const envelope = await runSkills(alias, getOpts());
    emitOutput(envelope);
  });

program
  .command("inspect <server>")
  .description("Show server capabilities, version, and metadata")
  .action(async (server: string) => {
    const alias = server.startsWith("/") ? server.slice(1) : server;
    const envelope = await runInspect({ ...getOpts(), serverAlias: alias });
    emitOutput(envelope);
  });

program
  .command("prompts <server>")
  .description("List available prompts from a server")
  .action(async (server: string) => {
    const alias = server.startsWith("/") ? server.slice(1) : server;
    const envelope = await runListPrompts({ ...getOpts(), serverAlias: alias });
    emitOutput(envelope);
  });

program
  .command("prompt <server> <name>")
  .description("Get a prompt template from a server")
  .option("--args <json>", "Prompt arguments as JSON")
  .action(async (server: string, name: string, opts: { args?: string }) => {
    const alias = server.startsWith("/") ? server.slice(1) : server;
    const args = opts.args ? JSON.parse(opts.args) : {};
    const envelope = await runGetPrompt(name, args, { ...getOpts(), serverAlias: alias });
    emitOutput(envelope);
  });

program
  .command("alias <action> [name] [command]")
  .description("Manage tool aliases (list | set <name> <command> | remove <name>)")
  .action(async (action: string, name?: string, command?: string) => {
    const envelope = await runAlias(action, name, command);
    emitOutput(envelope);
  });

program
  .command("run <name>")
  .description("Execute a saved alias")
  .allowUnknownOption()
  .allowExcessArguments()
  .helpOption(false)
  .action(async (name: string, _opts: unknown, cmd: Command) => {
    const extraArgs = cmd.args.filter((a) => a !== name);
    const envelope = await runAliasExec(name, extraArgs, getOpts());
    emitOutput(envelope);
  });

program
  .command("interactive [server]")
  .alias("i")
  .description("Start interactive REPL mode")
  .action(async (server?: string) => {
    const alias = server?.startsWith("/") ? server.slice(1) : server;
    await runInteractive(getOpts(), alias);
  });

program
  .command("watch <interval> <server> <tool>")
  .description("Re-execute a tool periodically (e.g., watch 5s /pg list_active_queries)")
  .allowUnknownOption()
  .allowExcessArguments()
  .helpOption(false)
  .action(async (interval: string, server: string, tool: string, _opts: unknown, cmd: Command) => {
    const alias = server.startsWith("/") ? server.slice(1) : server;
    const toolArgs = cmd.args.filter((a) => a !== interval && a !== server && a !== tool);
    const ms = parseInterval(interval);
    if (!ms) {
      emitOutput(errorEnvelope(EXIT.VALIDATION_ERROR, `Invalid interval: ${interval}. Use format like 5s, 1m, 500ms`));
      return;
    }

    // First execution
    const opts = { ...getOpts(), serverAlias: alias };
    const first = await invokeTool(tool, toolArgs, opts);
    console.log(JSON.stringify(first));

    // Subsequent executions
    const timer = setInterval(async () => {
      const result = await invokeTool(tool, toolArgs, opts);
      console.log(JSON.stringify(result));
    }, ms);

    // Clean exit on Ctrl+C
    process.on("SIGINT", () => {
      clearInterval(timer);
      process.exit(0);
    });
  });

program
  .command("completion [shell]")
  .description("Generate shell completion script (bash or zsh)")
  .action((shell?: string) => {
    const s = shell ?? (process.env.SHELL?.includes("zsh") ? "zsh" : "bash");
    if (s === "zsh") {
      console.log(generateZshCompletion());
    } else {
      console.log(generateBashCompletion());
    }
    process.exit(0);
  });

program
  .command("daemon <action>")
  .description("Manage the connection daemon (start|stop|status|flush)")
  .action(async (action: string) => {
    const daemon = new DaemonClient();

    if (action === "start") {
      if (await daemon.tryConnect()) {
        const alive = await daemon.ping();
        daemon.close();
        if (alive) {
          emitOutput(successResult([{ type: "text", text: "Daemon is already running." }]));
          return;
        }
      }
      // tryConnect auto-starts the daemon
      const connected = await daemon.tryConnect();
      daemon.close();
      if (connected) {
        emitOutput(successResult([{ type: "text", text: "Daemon started." }]));
      } else {
        emitOutput(errorEnvelope(EXIT.INTERNAL_ERROR, "Failed to start daemon."));
      }
    } else if (action === "stop") {
      if (await daemon.tryConnect()) {
        await daemon.shutdown();
        daemon.close();
        emitOutput(successResult([{ type: "text", text: "Daemon stopped." }]));
      } else {
        emitOutput(successResult([{ type: "text", text: "Daemon is not running." }]));
      }
    } else if (action === "status") {
      if (await daemon.tryConnect()) {
        const alive = await daemon.ping();
        daemon.close();
        if (alive) {
          emitOutput(successResult([{ type: "text", text: "Daemon is running." }]));
        } else {
          emitOutput(successResult([{ type: "text", text: "Daemon is not responding." }]));
        }
      } else {
        emitOutput(successResult([{ type: "text", text: "Daemon is not running." }]));
      }
    } else if (action === "flush") {
      if (await daemon.tryConnect()) {
        await daemon.flush();
        daemon.close();
        emitOutput(successResult([{ type: "text", text: "All cached connections flushed." }]));
      } else {
        emitOutput(successResult([{ type: "text", text: "Daemon is not running." }]));
      }
    } else {
      emitOutput(errorEnvelope(EXIT.VALIDATION_ERROR, `Unknown daemon action: ${action}. Use start, stop, status, or flush.`));
    }
  });

function parseInterval(s: string): number | null {
  const match = s.match(/^(\d+)(ms|s|m)$/);
  if (!match) return null;
  const [, num, unit] = match;
  const n = parseInt(num, 10);
  if (unit === "ms") return n;
  if (unit === "s") return n * 1000;
  if (unit === "m") return n * 60_000;
  return null;
}

/**
 * Find a bare /server arg (no tool name following it) after skipping global flags.
 * Returns the server alias (without leading /) or null.
 */
function findBareServer(args: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    if (GLOBAL_VALUE_FLAGS.has(args[i])) { i++; continue; }
    if (args[i] === "--verbose" || args[i] === "-v") continue;
    if (args[i].startsWith("/")) return args[i].slice(1);
    break;
  }
  return null;
}

// Check for -p shorthand
const pIdx = process.argv.indexOf("-p");
if (pIdx !== -1 && pIdx + 1 >= process.argv.length) {
  output(errorEnvelope(EXIT.VALIDATION_ERROR, "Missing value for -p. Expected: -p '/server tool [--params '{}']'"));
} else if (pIdx !== -1) {
  const pSlash = parsePShorthand(process.argv[pIdx + 1]);
  if (pSlash) {
    const globalOpts = extractGlobalOpts(process.argv);
    invokeTool(pSlash.toolName, pSlash.toolArgs, { serverAlias: pSlash.serverAlias, ...globalOpts })
      .then((envelope) => emitOutput(envelope, globalOpts.format))
      .catch((err) => emitOutput(errorEnvelope(EXIT.INTERNAL_ERROR, err.message), globalOpts.format));
  } else {
    output(errorEnvelope(EXIT.VALIDATION_ERROR, "Invalid -p format. Expected: /server tool [--params '{}']"));
  }
} else {
  // Check for slash-command pattern
  const slash = parseSlashCommand(process.argv);
  if (slash) {
    const globalOpts = extractGlobalOpts(process.argv);
    invokeTool(slash.toolName, slash.toolArgs, { serverAlias: slash.serverAlias, ...globalOpts })
      .then((envelope) => emitOutput(envelope, globalOpts.format))
      .catch((err) => emitOutput(errorEnvelope(EXIT.INTERNAL_ERROR, err.message), globalOpts.format));
  } else {
    // Check for bare /server (no tool name) — treat as list
    const bareServer = findBareServer(process.argv.slice(2));
    if (bareServer) {
      const globalOpts = extractGlobalOpts(process.argv);
      listTools({ ...globalOpts, serverAlias: bareServer })
        .then((envelope) => emitOutput(envelope, globalOpts.format))
        .catch((err) => emitOutput(errorEnvelope(EXIT.INTERNAL_ERROR, err.message), globalOpts.format));
    } else {
      program.parseAsync().catch((err) => {
        output(errorEnvelope(EXIT.INTERNAL_ERROR, err.message));
      });
    }
  }
}
