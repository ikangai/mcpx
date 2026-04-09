import { search, input, confirm, select, number as numberPrompt } from "@inquirer/prompts";
import chalk from "chalk";
import { McpClient } from "../mcp/client.js";
import { formatResult, detectFormat } from "../output/formatter.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { AnnotatedTool } from "../mcp/types.js";
import { resolveServer, ConfigError } from "../cli/commands.js";

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
}, serverAlias?: string): Promise<void> {
  const serverConfig = resolveServer({
    ...globalOpts,
    serverAlias,
  });
  const client = new McpClient();

  try {
    await client.connect(serverConfig);
    const tools = await client.listTools();

    if (tools.length === 0) {
      console.log("No tools available from this server.");
      return;
    }

    // Gather server metadata
    const version = client.getServerVersion();
    const capabilities = client.getServerCapabilities();
    const prompts = await client.listPrompts();
    const resources = await client.listResources();
    const instructions = client.getInstructions();

    console.log(chalk.bold(`\nConnected to ${version?.name ?? "server"} v${version?.version ?? "?"}`));
    console.log(`  ${tools.length} tools${prompts.length > 0 ? `, ${prompts.length} prompts` : ""}${resources.length > 0 ? `, ${resources.length} resources` : ""}`);
    if (instructions) console.log(chalk.dim(`  ${instructions.slice(0, 120)}${instructions.length > 120 ? "..." : ""}`));
    console.log();

    while (true) {
      let mode = "tool";

      // If server has prompts or resources, offer a mode choice
      if (prompts.length > 0 || resources.length > 0) {
        const choices = [
          { name: `Tools (${tools.length})`, value: "tool" },
        ];
        if (prompts.length > 0) choices.push({ name: `Prompts (${prompts.length})`, value: "prompt" });
        if (resources.length > 0) choices.push({ name: `Resources (${resources.length})`, value: "resource" });

        mode = await select({
          message: "What would you like to do?",
          choices,
        });
      }

      if (mode === "tool") {
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
            return filtered.map((t) => {
              const annotations = (t as AnnotatedTool).annotations;
              let suffix = "";
              if (annotations?.destructiveHint) suffix += " \u26a0 destructive";
              if (annotations?.readOnlyHint) suffix += " \ud83d\udd12 read-only";
              return {
                name: `${t.name} \u2014 ${t.description ?? ""}${suffix}`,
                value: t.name,
              };
            });
          },
        });

        const tool = tools.find((t) => t.name === toolName)!;
        console.log(chalk.dim(`\n${tool.description ?? ""}\n`));

        const { args, cmdLine } = await promptForArgs(tool);

        const result = await client.callTool(toolName, args, {
          onProgress: (progress) => {
            const pct = progress.total ? Math.round((progress.progress / progress.total) * 100) : null;
            const bar = pct !== null ? `[${pct}%] ` : "";
            process.stderr.write(`\r${bar}${progress.message ?? ""}`.padEnd(60));
          },
        }) as { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; isError?: boolean };
        process.stderr.write("\r" + " ".repeat(60) + "\r"); // clear progress line

        const format = detectFormat();

        console.log("\n" + formatResult(result, format) + "\n");

        // Show the equivalent CLI command
        let hint: string;
        if (serverAlias) {
          hint = `mcpx /${serverAlias} ${toolName} --params '${JSON.stringify(args)}'`;
        } else {
          const serverFlag = globalOpts.server
            ? `-s "${globalOpts.server}"`
            : `-c "${globalOpts.config}"${globalOpts.serverName ? ` -n ${globalOpts.serverName}` : ""}`;
          hint = `mcpx ${serverFlag} exec ${toolName} ${cmdLine.join(" ")}`;
        }
        console.log(chalk.dim(`  Run again: ${hint}\n`));
      } else if (mode === "prompt") {
        const promptName = await search({
          message: "Select a prompt",
          source: async (term) => {
            const filtered = term
              ? prompts.filter((p) => p.name.includes(term) || (p.description?.toLowerCase().includes(term.toLowerCase()) ?? false))
              : prompts;
            return filtered.map((p) => ({
              name: `${p.name} \u2014 ${p.description ?? ""}`,
              value: p.name,
            }));
          },
        });

        try {
          const result = await client.getPrompt(promptName);
          console.log("\n" + JSON.stringify(result, null, 2) + "\n");
        } catch (err) {
          console.log(chalk.red(`\nError: ${(err as Error).message}\n`));
        }
      } else if (mode === "resource") {
        const resourceUri = await search({
          message: "Select a resource",
          source: async (term) => {
            const filtered = term
              ? resources.filter((r) => r.uri.includes(term) || (r.name?.toLowerCase().includes(term.toLowerCase()) ?? false))
              : resources;
            return filtered.map((r) => ({
              name: `${r.name ?? r.uri} \u2014 ${r.description ?? ""} ${r.mimeType ? `(${r.mimeType})` : ""}`,
              value: r.uri,
            }));
          },
        });

        try {
          const result = await client.readResource(resourceUri);
          console.log("\n" + JSON.stringify(result, null, 2) + "\n");
        } catch (err) {
          console.log(chalk.red(`\nError: ${(err as Error).message}\n`));
        }
      }
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
