import { Command } from "commander";
import type { Envelope } from "../../output/envelope.js";
import { runSkills, runInspect, runListPrompts, runGetPrompt, runListResources, runReadResource, runDiff, runTest } from "../operations.js";
import type { ServerOpts } from "../commands.js";

export function registerObserveCommands(
  program: Command,
  emitOutput: (envelope: Envelope, fmt?: string) => never,
  getOpts: () => ServerOpts,
): void {
  program
    .command("inspect <server>")
    .description("Show server capabilities, version, and metadata")
    .action(async (server: string) => {
      const alias = server.startsWith("/") ? server.slice(1) : server;
      const envelope = await runInspect({ ...getOpts(), serverAlias: alias });
      emitOutput(envelope);
    });

  program
    .command("prompts <server>")
    .description("List available prompts from a server")
    .action(async (server: string) => {
      const alias = server.startsWith("/") ? server.slice(1) : server;
      const envelope = await runListPrompts({ ...getOpts(), serverAlias: alias });
      emitOutput(envelope);
    });

  program
    .command("prompt <server> <name>")
    .description("Get a prompt template from a server")
    .option("--args <json>", "Prompt arguments as JSON")
    .action(async (server: string, name: string, opts: { args?: string }) => {
      const alias = server.startsWith("/") ? server.slice(1) : server;
      const args = opts.args ? JSON.parse(opts.args) : {};
      const envelope = await runGetPrompt(name, args, { ...getOpts(), serverAlias: alias });
      emitOutput(envelope);
    });

  program
    .command("resources <server>")
    .description("List available resources from a server")
    .action(async (server: string) => {
      const alias = server.startsWith("/") ? server.slice(1) : server;
      const envelope = await runListResources({ ...getOpts(), serverAlias: alias });
      emitOutput(envelope);
    });

  program
    .command("resource <server> <uri>")
    .description("Read a resource by URI from a server")
    .action(async (server: string, uri: string) => {
      const alias = server.startsWith("/") ? server.slice(1) : server;
      const envelope = await runReadResource(uri, { ...getOpts(), serverAlias: alias });
      emitOutput(envelope);
    });

  program
    .command("diff <server>")
    .description("Compare tool schemas against last snapshot")
    .action(async (server: string) => {
      const alias = server.startsWith("/") ? server.slice(1) : server;
      const envelope = await runDiff(alias, getOpts());
      emitOutput(envelope);
    });

  program
    .command("test <server>")
    .description("Verify a server is reachable and responding")
    .action(async (server: string) => {
      const alias = server.startsWith("/") ? server.slice(1) : server;
      const envelope = await runTest({ ...getOpts(), serverAlias: alias });
      emitOutput(envelope);
    });

  program
    .command("skills <server>")
    .description("Generate agent skill documentation for a server")
    .action(async (server: string) => {
      const alias = server.startsWith("/") ? server.slice(1) : server;
      const envelope = await runSkills(alias, getOpts());
      emitOutput(envelope);
    });
}
