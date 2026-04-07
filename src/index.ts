#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";

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
import { invokeTool, listTools, runAdd, runServers, runRemove, getToolSchema, runImport, runSkills } from "./cli/commands.js";
import { parseSlashCommand, parsePShorthand } from "./cli/router.js";
import { runInteractive } from "./interactive/repl.js";
import { output, errorEnvelope, EXIT, type Envelope } from "./output/envelope.js";
import { DaemonClient } from "./daemon/client.js";

const program = new Command();

program
  .name("mcpx")
  .description("Transform MCP servers into CLI commands")
  .version("0.1.0")
  .option("-s, --server <command>", "MCP server command (inline)")
  .option("-c, --config <file>", "Path to config file")
  .option("-n, --server-name <name>", "Server name from config")
  .option("-v, --verbose", "Show debug info")
  .option("-t, --timeout <ms>", "Connection timeout in milliseconds", "30000");

program
  .command("list [server]")
  .description("List available tools (optionally filter by /server)")
  .action(async (server?: string) => {
    let envelope: Envelope;
    if (server?.startsWith("/")) {
      envelope = await listTools({ serverAlias: server.slice(1) });
    } else if (program.opts().server || program.opts().config) {
      envelope = await listTools(program.opts());
    } else {
      envelope = await listTools({});
    }
    output(envelope);
  });

program
  .command("exec <tool>")
  .description("Execute an MCP tool")
  .allowUnknownOption()
  .allowExcessArguments()
  .action(async (toolName: string, _opts: unknown, cmd: Command) => {
    const toolArgs = cmd.args.filter((a) => a !== toolName);
    const envelope = await invokeTool(toolName, toolArgs, program.opts());
    output(envelope);
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
    output(envelope);
  });

program
  .command("schema <server> <tool>")
  .description("Show full input schema for a tool")
  .action(async (server: string, tool: string) => {
    const alias = server.startsWith("/") ? server.slice(1) : server;
    const envelope = await getToolSchema(tool, { serverAlias: alias });
    output(envelope);
  });

program
  .command("servers")
  .description("List registered servers")
  .action(async () => {
    const envelope = await runServers();
    output(envelope);
  });

program
  .command("remove <alias>")
  .description("Remove a registered server")
  .action(async (alias: string) => {
    const envelope = await runRemove(alias);
    output(envelope);
  });

program
  .command("import [config-path]")
  .description("Import servers from Claude Desktop config")
  .action(async (configPath?: string) => {
    const envelope = await runImport(configPath);
    output(envelope);
  });

program
  .command("skills <server>")
  .description("Generate agent skill documentation for a server")
  .action(async (server: string) => {
    const alias = server.startsWith("/") ? server.slice(1) : server;
    const envelope = await runSkills(alias, program.opts());
    output(envelope);
  });

program
  .command("interactive [server]")
  .alias("i")
  .description("Start interactive REPL mode")
  .action(async (server?: string) => {
    const alias = server?.startsWith("/") ? server.slice(1) : server;
    await runInteractive(program.opts(), alias);
  });

program
  .command("daemon <action>")
  .description("Manage the connection daemon (start|stop|status)")
  .action(async (action: string) => {
    const daemon = new DaemonClient();

    if (action === "start") {
      if (await daemon.tryConnect()) {
        const alive = await daemon.ping();
        daemon.close();
        if (alive) {
          output({ ok: true, type: "result", content: [{ type: "text", text: "Daemon is already running." }] } as Envelope);
          return;
        }
      }
      // tryConnect auto-starts the daemon
      const connected = await daemon.tryConnect();
      daemon.close();
      if (connected) {
        output({ ok: true, type: "result", content: [{ type: "text", text: "Daemon started." }] } as Envelope);
      } else {
        output(errorEnvelope(EXIT.INTERNAL_ERROR, "Failed to start daemon."));
      }
    } else if (action === "stop") {
      if (await daemon.tryConnect()) {
        await daemon.shutdown();
        daemon.close();
        output({ ok: true, type: "result", content: [{ type: "text", text: "Daemon stopped." }] } as Envelope);
      } else {
        output({ ok: true, type: "result", content: [{ type: "text", text: "Daemon is not running." }] } as Envelope);
      }
    } else if (action === "status") {
      if (await daemon.tryConnect()) {
        const alive = await daemon.ping();
        daemon.close();
        if (alive) {
          output({ ok: true, type: "result", content: [{ type: "text", text: "Daemon is running." }] } as Envelope);
        } else {
          output({ ok: true, type: "result", content: [{ type: "text", text: "Daemon is not responding." }] } as Envelope);
        }
      } else {
        output({ ok: true, type: "result", content: [{ type: "text", text: "Daemon is not running." }] } as Envelope);
      }
    } else {
      output(errorEnvelope(EXIT.VALIDATION_ERROR, `Unknown daemon action: ${action}. Use start, stop, or status.`));
    }
  });

// Check for -p shorthand
const pIdx = process.argv.indexOf("-p");
if (pIdx !== -1 && pIdx + 1 < process.argv.length) {
  const pSlash = parsePShorthand(process.argv[pIdx + 1]);
  if (pSlash) {
    invokeTool(pSlash.toolName, pSlash.toolArgs, { serverAlias: pSlash.serverAlias })
      .then((envelope) => output(envelope))
      .catch((err) => output(errorEnvelope(EXIT.INTERNAL_ERROR, err.message)));
  } else {
    output(errorEnvelope(EXIT.VALIDATION_ERROR, "Invalid -p format. Expected: /server tool [--params '{}']"));
  }
} else {
  // Check for slash-command pattern
  const slash = parseSlashCommand(process.argv);
  if (slash) {
    invokeTool(slash.toolName, slash.toolArgs, { serverAlias: slash.serverAlias })
      .then((envelope) => output(envelope))
      .catch((err) => output(errorEnvelope(EXIT.INTERNAL_ERROR, err.message)));
  } else {
    program.parseAsync().catch((err) => {
      output(errorEnvelope(EXIT.INTERNAL_ERROR, err.message));
    });
  }
}
