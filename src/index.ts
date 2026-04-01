#!/usr/bin/env node
import { Command } from "commander";
import { runList, runExec } from "./cli/commands.js";
import { runInteractive } from "./interactive/repl.js";

const program = new Command();

program
  .name("mcpx")
  .description("Transform MCP servers into CLI commands")
  .version("0.1.0")
  .option("-s, --server <command>", "MCP server command (inline)")
  .option("-c, --config <file>", "Path to config file")
  .option("-n, --server-name <name>", "Server name from config")
  .option("-f, --format <format>", "Output format: json | table | yaml", "auto")
  .option("--raw", "Output raw MCP response")
  .option("-v, --verbose", "Show debug info");

program
  .command("list")
  .description("List available tools from the MCP server")
  .action(async () => {
    await runList(program.opts());
  });

program
  .command("exec <tool>")
  .description("Execute an MCP tool")
  .allowUnknownOption()
  .action(async (toolName: string, _opts: unknown, cmd: Command) => {
    // Everything after 'exec <tool>' goes to the tool flag parser
    const toolArgs = cmd.args.slice(0);
    await runExec(toolName, toolArgs, program.opts());
  });

program
  .command("interactive")
  .alias("i")
  .description("Start interactive REPL mode")
  .action(async () => {
    await runInteractive(program.opts());
  });

program.parseAsync().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
