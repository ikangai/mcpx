#!/usr/bin/env node
import { Command } from "commander";
import { invokeTool, listTools, runAdd, runServers, runRemove, getToolSchema, runImport } from "./cli/commands.js";
import { parseSlashCommand, parsePShorthand } from "./cli/router.js";
import { runInteractive } from "./interactive/repl.js";
import { output, errorEnvelope, EXIT, type Envelope } from "./output/envelope.js";

const program = new Command();

program
  .name("mcpx")
  .description("Transform MCP servers into CLI commands")
  .version("0.1.0")
  .option("-s, --server <command>", "MCP server command (inline)")
  .option("-c, --config <file>", "Path to config file")
  .option("-n, --server-name <name>", "Server name from config")
  .option("-v, --verbose", "Show debug info");

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
  .command("interactive [server]")
  .alias("i")
  .description("Start interactive REPL mode")
  .action(async (server?: string) => {
    const alias = server?.startsWith("/") ? server.slice(1) : server;
    await runInteractive(program.opts(), alias);
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
