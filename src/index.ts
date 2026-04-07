#!/usr/bin/env node
import { Command } from "commander";
import { runList, runExec, runAdd, runSlashExec } from "./cli/commands.js";
import { parseSlashCommand } from "./cli/router.js";
import { runInteractive } from "./interactive/repl.js";
import { output, errorEnvelope, EXIT } from "./output/envelope.js";

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
  .command("list")
  .description("List available tools from the MCP server")
  .action(async () => {
    const envelope = await runList(program.opts());
    output(envelope);
  });

program
  .command("exec <tool>")
  .description("Execute an MCP tool")
  .allowUnknownOption()
  .allowExcessArguments()
  .action(async (toolName: string, _opts: unknown, cmd: Command) => {
    const toolArgs = cmd.args.filter((a) => a !== toolName);
    const envelope = await runExec(toolName, toolArgs, program.opts());
    output(envelope);
  });

program
  .command("add <alias> <command>")
  .description("Register an MCP server with a short alias")
  .action(async (alias: string, command: string) => {
    const envelope = await runAdd(alias, command);
    output(envelope);
  });

program
  .command("interactive")
  .alias("i")
  .description("Start interactive REPL mode")
  .action(async () => {
    await runInteractive(program.opts());
  });

// Check for slash-command pattern before commander parses
const slash = parseSlashCommand(process.argv);
if (slash) {
  runSlashExec(slash.serverAlias, slash.toolName, slash.toolArgs)
    .then((envelope) => output(envelope))
    .catch((err) => output(errorEnvelope(EXIT.INTERNAL_ERROR, err.message)));
} else {
  program.parseAsync().catch((err) => {
    output(errorEnvelope(EXIT.INTERNAL_ERROR, err.message));
  });
}
