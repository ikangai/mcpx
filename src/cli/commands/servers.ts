import { Command } from "commander";
import type { Envelope } from "../../output/envelope.js";
import { runAdd, runUpdate, runServers, runRemove, runImport } from "../operations.js";
import type { ServerOpts } from "../commands.js";

export function registerServerCommands(
  program: Command,
  emitOutput: (envelope: Envelope, fmt?: string) => never,
  _getOpts: () => ServerOpts,
): void {
  program
    .command("add <alias> <command-or-url>")
    .description("Register an MCP server (stdio command or HTTP URL)")
    .option("-e, --env <KEY=VALUE...>", "Set environment variable (repeatable)")
    .option("-H, --header <Key:Value...>", "Set HTTP header (repeatable)")
    .option("--transport <type>", "Transport type: stdio, sse, http (auto-detected)")
    .option("--oauth-client-id <id>", "OAuth client ID")
    .option("--oauth-client-secret <secret>", "OAuth client secret")
    .option("--oauth-scope <scope>", "OAuth scope")
    .action(async (alias: string, commandOrUrl: string, opts: {
      env?: string[];
      header?: string[];
      transport?: "stdio" | "sse" | "http";
      oauthClientId?: string;
      oauthClientSecret?: string;
      oauthScope?: string;
    }) => {
      const env: Record<string, string> = {};
      for (const e of opts.env ?? []) {
        const idx = e.indexOf("=");
        if (idx > 0) env[e.slice(0, idx)] = e.slice(idx + 1);
      }

      const headers: Record<string, string> = {};
      for (const h of opts.header ?? []) {
        const idx = h.indexOf(":");
        if (idx > 0) headers[h.slice(0, idx).trim()] = h.slice(idx + 1).trim();
      }

      const isUrl = commandOrUrl.startsWith("http://") || commandOrUrl.startsWith("https://");

      const oauth = opts.oauthClientId && opts.oauthClientSecret
        ? { clientId: opts.oauthClientId, clientSecret: opts.oauthClientSecret, scope: opts.oauthScope }
        : undefined;

      const httpOpts = isUrl ? {
        url: commandOrUrl,
        transport: opts.transport,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        oauth,
      } : undefined;

      const envelope = await runAdd(
        alias,
        commandOrUrl,
        Object.keys(env).length > 0 ? env : undefined,
        httpOpts,
      );
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
