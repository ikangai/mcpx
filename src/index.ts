#!/usr/bin/env node

// Global error handlers — prevent silent crashes
process.on("unhandledRejection", (err) => {
  console.error(JSON.stringify({ ok: false, error: { code: 5, message: `Unhandled: ${err instanceof Error ? err.message : String(err)}` } }));
  process.exit(5);
});
process.on("uncaughtException", (err) => {
  console.error(JSON.stringify({ ok: false, error: { code: 5, message: `Internal: ${err.message}` } }));
  process.exit(5);
});

import { readFileSync, existsSync } from "node:fs";

// Early arg scanning for --config-dir (must be set before any imports read it)
const configDirIdx = process.argv.indexOf("--config-dir");
if (configDirIdx !== -1 && configDirIdx + 1 < process.argv.length) {
  process.env.MCPX_CONFIG_DIR = process.argv[configDirIdx + 1];
}

// Early arg scanning for --log (must be set before commands run)
const logIdx = process.argv.indexOf("--log");
if (logIdx !== -1 && logIdx + 1 < process.argv.length) {
  import("./audit/logger.js").then(({ setLogPath }) => setLogPath(process.argv[logIdx + 1]));
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
import { invokeTool, listTools } from "./cli/commands.js";
import { parseSlashCommand, parsePShorthand, GLOBAL_VALUE_FLAGS } from "./cli/router.js";
import { output, errorEnvelope, EXIT, type Envelope } from "./output/envelope.js";
import { formatResult, formatToolList, detectFormat, type Format } from "./output/formatter.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import YAML from "yaml";
import { registerCommands } from "./cli/register.js";

function extractGlobalOpts(argv: string[]): { verbose?: boolean; timeout?: number; format?: string; raw?: boolean } {
  const opts: { verbose?: boolean; timeout?: number; format?: string; raw?: boolean } = {};
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--verbose" || args[i] === "-v") opts.verbose = true;
    if (args[i] === "--raw" || args[i] === "-r") opts.raw = true;
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
  // --field auto-implies --raw when output is piped (not a TTY)
  const fieldExtracted = (envelope as any)._fieldExtracted;
  if (fieldExtracted) delete (envelope as any)._fieldExtracted;

  const isRaw = formatOverride === "raw" || program.opts().raw || (fieldExtracted && !process.stdout.isTTY);
  if (isRaw) {
    return output(envelope, true);
  }

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
    if (args[i] === "--verbose" || args[i] === "-v" || args[i] === "--raw" || args[i] === "-r") continue;
    if (args[i].startsWith("/")) return args[i].slice(1);
    break;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Program setup
// ---------------------------------------------------------------------------

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
  .option("--config-dir <path>", "Override config directory (default: ~/.config/mcpx)")
  .option("--log <path>", "Append tool invocations to NDJSON log file")
  .option("-r, --raw", "Output raw content without JSON envelope (saves tokens for agents)");

registerCommands(program, emitOutput, getOpts, parseInterval);

// ---------------------------------------------------------------------------
// Routing: -p shorthand, slash commands, bare /server, commander fallback
// ---------------------------------------------------------------------------

// Check for -p shorthand
const pIdx = process.argv.indexOf("-p");
if (pIdx !== -1 && pIdx + 1 >= process.argv.length) {
  output(errorEnvelope(EXIT.VALIDATION_ERROR, "Missing value for -p. Expected: -p '/server tool [--params '{}']'"));
} else if (pIdx !== -1) {
  const pSlash = parsePShorthand(process.argv[pIdx + 1]);
  if (pSlash) {
    const globalOpts = extractGlobalOpts(process.argv);
    const fmt = globalOpts.raw ? "raw" : globalOpts.format;
    invokeTool(pSlash.toolName, pSlash.toolArgs, { serverAlias: pSlash.serverAlias, ...globalOpts })
      .then((envelope) => emitOutput(envelope, fmt))
      .catch((err) => emitOutput(errorEnvelope(EXIT.INTERNAL_ERROR, err.message), fmt));
  } else {
    output(errorEnvelope(EXIT.VALIDATION_ERROR, "Invalid -p format. Expected: /server tool [--params '{}']"));
  }
} else {
  // Check for slash-command pattern
  const slash = parseSlashCommand(process.argv);
  if (slash) {
    const globalOpts = extractGlobalOpts(process.argv);
    const fmt = globalOpts.raw ? "raw" : globalOpts.format;
    invokeTool(slash.toolName, slash.toolArgs, { serverAlias: slash.serverAlias, ...globalOpts })
      .then((envelope) => emitOutput(envelope, fmt))
      .catch((err) => emitOutput(errorEnvelope(EXIT.INTERNAL_ERROR, err.message), fmt));
  } else {
    // Check for bare /server (no tool name) — treat as list
    const bareServer = findBareServer(process.argv.slice(2));
    if (bareServer) {
      const globalOpts = extractGlobalOpts(process.argv);
      const fmt = globalOpts.raw ? "raw" : globalOpts.format;
      listTools({ ...globalOpts, serverAlias: bareServer })
        .then((envelope) => emitOutput(envelope, fmt))
        .catch((err) => emitOutput(errorEnvelope(EXIT.INTERNAL_ERROR, err.message), fmt));
    } else {
      program.parseAsync().catch((err) => {
        output(errorEnvelope(EXIT.INTERNAL_ERROR, err.message));
      });
    }
  }
}
