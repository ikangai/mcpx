import { Command } from "commander";
import type { Envelope } from "../output/envelope.js";
import type { ServerOpts } from "./commands.js";
import { registerToolCommands } from "./commands/tools.js";
import { registerServerCommands } from "./commands/servers.js";
import { registerObserveCommands } from "./commands/observe.js";
import { registerManageCommands } from "./commands/manage.js";

export function registerCommands(
  program: Command,
  emitOutput: (envelope: Envelope, fmt?: string) => never,
  getOpts: () => ServerOpts,
  parseInterval: (s: string) => number | null,
): void {
  registerToolCommands(program, emitOutput, getOpts, parseInterval);
  registerServerCommands(program, emitOutput, getOpts);
  registerObserveCommands(program, emitOutput, getOpts);
  registerManageCommands(program, emitOutput, getOpts);
}
