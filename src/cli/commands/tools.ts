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
    .option("--parallel <n>", "Execute up to N tool calls concurrently (default: 1 = sequential)", "1")
    .addHelpText("after", `
Reads NDJSON from stdin, each line: {"tool":"name","params":{...}}
Outputs one JSON result per line (NDJSON).

Example:
  echo '{"tool":"echo","params":{"message":"hello"}}
{"tool":"get-sum","params":{"a":1,"b":2}}' | mcpx batch /everything

  # Run 4 calls concurrently:
  cat requests.ndjson | mcpx batch /server --parallel 4

Saves API roundtrips when an agent needs multiple tool calls.
`)
    .action(async (server: string, cmdOpts: { parallel?: string }) => {
      const alias = server.startsWith("/") ? server.slice(1) : server;
      const opts = { ...getOpts(), serverAlias: alias };
      const concurrency = Math.max(1, parseInt(cmdOpts.parallel ?? "1", 10));

      const rl = createInterface({ input: process.stdin, terminal: false });
      const lines: string[] = [];

      for await (const line of rl) {
        const trimmed = line.trim();
        if (trimmed) lines.push(trimmed);
      }

      if (concurrency <= 1) {
        // Sequential (original behavior)
        for (const line of lines) {
          try {
            const req = JSON.parse(line) as { tool: string; params?: Record<string, unknown> };
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
      } else {
        // Parallel: process in chunks of `concurrency`, preserve order
        const requests = lines.map((line, i) => {
          try {
            const req = JSON.parse(line) as { tool: string; params?: Record<string, unknown> };
            return { index: i, req, error: undefined as string | undefined };
          } catch (err) {
            return { index: i, req: null, error: (err as Error).message };
          }
        });

        const results: string[] = new Array(requests.length);

        for (let i = 0; i < requests.length; i += concurrency) {
          const chunk = requests.slice(i, i + concurrency);
          const promises = chunk.map(async (entry) => {
            if (!entry.req || entry.error) {
              return { index: entry.index, output: JSON.stringify({ ok: false, error: { code: 5, message: entry.error ?? "Parse error" } }) };
            }
            if (!entry.req.tool) {
              return { index: entry.index, output: JSON.stringify({ ok: false, error: { code: 3, message: "Missing 'tool' field" } }) };
            }
            try {
              const toolArgs = entry.req.params ? ["--params", JSON.stringify(entry.req.params)] : [];
              const envelope = await invokeTool(entry.req.tool, toolArgs, opts);
              return { index: entry.index, output: JSON.stringify(envelope) };
            } catch (err) {
              return { index: entry.index, output: JSON.stringify({ ok: false, error: { code: 5, message: (err as Error).message } }) };
            }
          });

          const chunkResults = await Promise.all(promises);
          for (const r of chunkResults) {
            results[r.index] = r.output;
          }
        }

        // Output in original order
        for (const line of results) {
          console.log(line);
        }
      }

      process.exit(0);
    });
}
