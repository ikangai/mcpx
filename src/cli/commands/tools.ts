import { Command } from "commander";
import { createInterface } from "node:readline";
import type { Envelope } from "../../output/envelope.js";
import { errorEnvelope, EXIT, successResult } from "../../output/envelope.js";
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
    .description("Execute an MCP tool (use -s or -c to specify server)")
    .addHelpText("after", `
Tool-specific options (passed through to the tool):
  --params <json>      Pass all arguments as JSON
  --json <json>        Alias for --params
  --params-stdin       Read params JSON from stdin
  --field <name>       Extract a specific field from the result
  --dry-run            Preview without executing
  --help               Show tool parameter schema

Examples:
  mcpx -s "npx @mcp/server" exec greet --name World
  mcpx -s "npx @mcp/server" exec search --params '{"query": "test"}'
`)
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

  program
    .command("batch <server>")
    .description("Execute multiple tools from NDJSON stdin (one {tool,params} per line)")
    .addHelpText("after", `
Reads NDJSON from stdin, each line: {"tool":"name","params":{...}}
Outputs one JSON result per line (NDJSON).

Example:
  echo '{"tool":"echo","params":{"message":"hello"}}
{"tool":"get-sum","params":{"a":1,"b":2}}' | mcpx batch /everything

Saves API roundtrips when an agent needs multiple tool calls.
`)
    .action(async (server: string) => {
      const alias = server.startsWith("/") ? server.slice(1) : server;
      const opts = { ...getOpts(), serverAlias: alias };

      const rl = createInterface({ input: process.stdin, terminal: false });

      for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const req = JSON.parse(trimmed) as { tool: string; params?: Record<string, unknown> };
          if (!req.tool) {
            console.log(JSON.stringify({ ok: false, error: { code: 3, message: "Missing 'tool' field" } }));
            continue;
          }
          const toolArgs = req.params ? ["--params", JSON.stringify(req.params)] : [];
          const envelope = await invokeTool(req.tool, toolArgs, opts);
          console.log(JSON.stringify(envelope));
        } catch (err) {
          console.log(JSON.stringify({ ok: false, error: { code: 5, message: (err as Error).message } }));
        }
      }

      process.exit(0);
    });
}
