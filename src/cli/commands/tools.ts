import { Command } from "commander";
import type { Envelope } from "../../output/envelope.js";
import { errorEnvelope, EXIT } from "../../output/envelope.js";
import { invokeTool, listTools, getToolSchema } from "../commands.js";
import type { ServerOpts } from "../commands.js";

export function registerToolCommands(
  program: Command,
  emitOutput: (envelope: Envelope, fmt?: string) => never,
  getOpts: () => ServerOpts,
  parseInterval: (s: string) => number | null,
): void {
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
    .command("schema <server> <tool>")
    .description("Show full input schema for a tool")
    .action(async (server: string, tool: string) => {
      const alias = server.startsWith("/") ? server.slice(1) : server;
      const envelope = await getToolSchema(tool, { ...getOpts(), serverAlias: alias });
      emitOutput(envelope);
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
}
