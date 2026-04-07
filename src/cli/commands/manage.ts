import { Command } from "commander";
import type { Envelope } from "../../output/envelope.js";
import { errorEnvelope, successResult, successEmpty, EXIT } from "../../output/envelope.js";
import { runAlias, runAliasExec } from "../operations.js";
import { generateBashCompletion, generateZshCompletion } from "../completion.js";
import { runInteractive } from "../../interactive/repl.js";
import { DaemonClient } from "../../daemon/client.js";
import type { ServerOpts } from "../commands.js";

export function registerManageCommands(
  program: Command,
  emitOutput: (envelope: Envelope, fmt?: string) => never,
  getOpts: () => ServerOpts,
): void {
  program
    .command("daemon <action>")
    .description("Manage the connection daemon (start|stop|status|flush)")
    .action(async (action: string) => {
      const daemon = new DaemonClient();

      if (action === "start") {
        if (await daemon.tryConnect()) {
          const alive = await daemon.ping();
          daemon.close();
          if (alive) {
            emitOutput(successResult([{ type: "text", text: "Daemon is already running." }]));
            return;
          }
        }
        // tryConnect auto-starts the daemon
        const connected = await daemon.tryConnect();
        daemon.close();
        if (connected) {
          emitOutput(successResult([{ type: "text", text: "Daemon started." }]));
        } else {
          emitOutput(errorEnvelope(EXIT.INTERNAL_ERROR, "Failed to start daemon."));
        }
      } else if (action === "stop") {
        if (await daemon.tryConnect()) {
          await daemon.shutdown();
          daemon.close();
          emitOutput(successResult([{ type: "text", text: "Daemon stopped." }]));
        } else {
          emitOutput(successResult([{ type: "text", text: "Daemon is not running." }]));
        }
      } else if (action === "status") {
        if (await daemon.tryConnect()) {
          const alive = await daemon.ping();
          daemon.close();
          if (alive) {
            emitOutput(successResult([{ type: "text", text: "Daemon is running." }]));
          } else {
            emitOutput(successResult([{ type: "text", text: "Daemon is not responding." }]));
          }
        } else {
          emitOutput(successResult([{ type: "text", text: "Daemon is not running." }]));
        }
      } else if (action === "flush") {
        if (await daemon.tryConnect()) {
          await daemon.flush();
          daemon.close();
          emitOutput(successResult([{ type: "text", text: "All cached connections flushed." }]));
        } else {
          emitOutput(successResult([{ type: "text", text: "Daemon is not running." }]));
        }
      } else {
        emitOutput(errorEnvelope(EXIT.VALIDATION_ERROR, `Unknown daemon action: ${action}. Use start, stop, status, or flush.`));
      }
    });

  program
    .command("alias <action> [name] [command]")
    .description("Manage tool aliases (list | set <name> <command> | remove <name>)")
    .action(async (action: string, name?: string, command?: string) => {
      const envelope = await runAlias(action, name, command);
      emitOutput(envelope);
    });

  program
    .command("run <name>")
    .description("Execute a saved alias")
    .allowUnknownOption()
    .allowExcessArguments()
    .helpOption(false)
    .action(async (name: string, _opts: unknown, cmd: Command) => {
      const extraArgs = cmd.args.filter((a) => a !== name);
      const envelope = await runAliasExec(name, extraArgs, getOpts());
      emitOutput(envelope);
    });

  program
    .command("hook <action> [pattern] [command]")
    .description("Manage hooks (list | add <pattern> <command> | remove <pattern>)")
    .action(async (action: string, pattern?: string, command?: string) => {
      if (action === "list") {
        const { getHooks } = await import("../../config/store.js");
        const hooks = getHooks();
        emitOutput(successResult([{ type: "text", text: JSON.stringify(hooks, null, 2) }]));
      } else if (action === "add" && pattern && command) {
        const { addHook } = await import("../../config/store.js");
        addHook(pattern, command);
        emitOutput(successEmpty());
      } else if (action === "remove" && pattern) {
        const { removeHook } = await import("../../config/store.js");
        if (!removeHook(pattern)) {
          emitOutput(errorEnvelope(EXIT.CONFIG_ERROR, `Hook "${pattern}" not found.`));
        } else {
          emitOutput(successEmpty());
        }
      } else {
        emitOutput(errorEnvelope(EXIT.VALIDATION_ERROR, "Usage: mcpx hook list | add <pattern> <command> | remove <pattern>"));
      }
    });

  program
    .command("completion [shell]")
    .description("Generate shell completion script (bash or zsh)")
    .action((shell?: string) => {
      const s = shell ?? (process.env.SHELL?.includes("zsh") ? "zsh" : "bash");
      if (s === "zsh") {
        console.log(generateZshCompletion());
      } else {
        console.log(generateBashCompletion());
      }
      process.exit(0);
    });

  program
    .command("interactive [server]")
    .alias("i")
    .description("Start interactive REPL mode")
    .action(async (server?: string) => {
      const alias = server?.startsWith("/") ? server.slice(1) : server;
      await runInteractive(getOpts(), alias);
    });

  program
    .command("serve")
    .description("Run mcpx as an MCP server (gateway for all registered servers)")
    .option("--port <port>", "Start HTTP server on this port (default: stdio)")
    .option("--token <token>", "Require Bearer token for HTTP authentication")
    .action(async (opts: { port?: string; token?: string }) => {
      const { startGateway } = await import("../../serve/gateway.js");
      await startGateway({
        verbose: program.opts().verbose,
        port: opts.port ? Number(opts.port) : undefined,
        token: opts.token,
      });
    });

  program
    .command("workflow <file>")
    .description("Run a multi-step workflow from a YAML file")
    .action(async (file: string) => {
      const { runWorkflow } = await import("../../workflows/runner.js");
      const envelope = await runWorkflow(file, getOpts());
      emitOutput(envelope);
    });
}
