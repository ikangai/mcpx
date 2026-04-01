import { search, input, confirm, select, number as numberPrompt } from "@inquirer/prompts";
import chalk from "chalk";
import { McpClient } from "../mcp/client.js";
import { parseServerSpec, parseConfigFile, type ServerConfig } from "../mcp/config.js";
import { formatResult, detectFormat } from "../output/formatter.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "node:fs";

async function resolveServerConfig(opts: {
  server?: string;
  config?: string;
  serverName?: string;
}): Promise<ServerConfig> {
  if (opts.server) return parseServerSpec(opts.server);
  if (opts.config) {
    const raw = readFileSync(opts.config, "utf-8");
    return parseConfigFile(JSON.parse(raw), opts.serverName);
  }
  throw new Error("Specify --server or --config");
}

async function promptForArgs(
  tool: Tool
): Promise<{ args: Record<string, unknown>; cmdLine: string[] }> {
  const schema = tool.inputSchema as {
    properties?: Record<string, { type?: string; description?: string; enum?: string[]; default?: unknown }>;
    required?: string[];
  };
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const args: Record<string, unknown> = {};
  const cmdParts: string[] = [];

  for (const [name, prop] of Object.entries(props)) {
    const label = `${name}${required.has(name) ? chalk.red("*") : ""} (${prop.type ?? "any"})${prop.description ? " - " + prop.description : ""}`;

    if (prop.enum) {
      const value = await select({
        message: label,
        choices: prop.enum.map((v) => ({ name: v, value: v })),
      });
      args[name] = value;
      cmdParts.push(`--${name}`, String(value));
    } else if (prop.type === "boolean") {
      const value = await confirm({
        message: label,
        default: (prop.default as boolean) ?? false,
      });
      args[name] = value;
      if (value) cmdParts.push(`--${name}`);
    } else if (prop.type === "number" || prop.type === "integer") {
      const value = await numberPrompt({
        message: label,
        required: required.has(name),
      });
      if (value !== undefined) {
        args[name] = value;
        cmdParts.push(`--${name}`, String(value));
      }
    } else {
      const value = await input({
        message: label,
        required: required.has(name),
      });
      if (value) {
        args[name] = value;
        cmdParts.push(`--${name}`, value);
      }
    }
  }

  return { args, cmdLine: cmdParts };
}

export async function runInteractive(globalOpts: {
  server?: string;
  config?: string;
  serverName?: string;
  format?: string;
}): Promise<void> {
  const serverConfig = await resolveServerConfig(globalOpts);
  const client = new McpClient();

  try {
    await client.connect(serverConfig);
    const tools = await client.listTools();

    if (tools.length === 0) {
      console.log("No tools available from this server.");
      return;
    }

    console.log(chalk.bold(`\nConnected. ${tools.length} tools available.\n`));

    while (true) {
      const toolName = await search({
        message: "Select a tool (type to search, Ctrl+C to exit)",
        source: async (term) => {
          const filtered = term
            ? tools.filter(
                (t) =>
                  t.name.includes(term) ||
                  (t.description?.toLowerCase().includes(term.toLowerCase()) ?? false)
              )
            : tools;
          return filtered.map((t) => ({
            name: `${t.name} — ${t.description ?? ""}`,
            value: t.name,
          }));
        },
      });

      const tool = tools.find((t) => t.name === toolName)!;
      console.log(chalk.dim(`\n${tool.description ?? ""}\n`));

      const { args, cmdLine } = await promptForArgs(tool);
      const result = await client.callTool(toolName, args) as {
        content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
        isError?: boolean;
      };
      const format = detectFormat(globalOpts.format);

      console.log("\n" + formatResult(result, format) + "\n");

      // Show the equivalent CLI command
      const serverFlag = globalOpts.server
        ? `-s "${globalOpts.server}"`
        : `-c "${globalOpts.config}"${globalOpts.serverName ? ` -n ${globalOpts.serverName}` : ""}`;
      console.log(
        chalk.dim(`  Run again: mcpx ${serverFlag} exec ${toolName} ${cmdLine.join(" ")}\n`)
      );
    }
  } catch (err) {
    if ((err as Error).name === "ExitPromptError") {
      console.log("\nGoodbye!");
      return;
    }
    throw err;
  } finally {
    await client.close();
  }
}
