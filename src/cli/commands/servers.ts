import { Command } from "commander";
import type { Envelope } from "../../output/envelope.js";
import { runAdd, runUpdate, runServers, runRemove, runImport } from "../commands.js";
import type { ServerOpts } from "../commands.js";

export function registerServerCommands(
  program: Command,
  emitOutput: (envelope: Envelope, fmt?: string) => never,
  _getOpts: () => ServerOpts,
): void {
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
      emitOutput(envelope);
    });

  program
    .command("servers")
    .description("List registered servers")
    .action(async () => {
      const envelope = await runServers();
      emitOutput(envelope);
    });

  program
    .command("remove <alias>")
    .description("Remove a registered server")
    .action(async (alias: string) => {
      const envelope = await runRemove(alias);
      emitOutput(envelope);
    });

  program
    .command("update <alias>")
    .description("Update a registered server's configuration")
    .option("--command <command>", "New server command")
    .option("-e, --env <KEY=VALUE...>", "Set/update environment variables")
    .action(async (alias: string, opts: { command?: string; env?: string[] }) => {
      const env: Record<string, string> = {};
      for (const e of opts.env ?? []) {
        const idx = e.indexOf("=");
        if (idx > 0) env[e.slice(0, idx)] = e.slice(idx + 1);
      }
      const envelope = await runUpdate(alias, {
        command: opts.command,
        env: Object.keys(env).length > 0 ? env : undefined,
      });
      emitOutput(envelope);
    });

  program
    .command("import [config-path]")
    .description("Import servers from Claude Desktop config")
    .option("--force", "Overwrite existing server aliases")
    .action(async (configPath?: string, opts?: { force?: boolean }) => {
      const envelope = await runImport(configPath, opts?.force);
      emitOutput(envelope);
    });
}
