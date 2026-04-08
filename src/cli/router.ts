/**
 * Detects slash-command invocations in argv and extracts
 * server alias, tool name, and remaining args.
 *
 * Pattern: mcpx /server tool [--params '{}'] [--flags]
 * Returns null if argv doesn't match the slash-command pattern.
 */
export interface SlashCommand {
  serverAlias: string;
  toolName: string;
  toolArgs: string[];
}

/** Global flags that consume a following value */
const GLOBAL_VALUE_FLAGS = new Set(["--server", "-s", "--config", "-c", "--server-name", "-n", "--timeout", "-t", "--format", "-f", "--config-dir", "--log"]);

export { GLOBAL_VALUE_FLAGS };

export function parseSlashCommand(argv: string[]): SlashCommand | null {
  // Skip node and script path (argv[0], argv[1])
  const args = argv.slice(2);

  // Find the first positional (non-flag) arg, skipping global flags and their values
  let slashIdx = -1;
  for (let i = 0; i < args.length; i++) {
    if (GLOBAL_VALUE_FLAGS.has(args[i])) {
      i++; // skip the flag's value
      continue;
    }
    if (args[i] === "--verbose" || args[i] === "-v" || args[i] === "--raw" || args[i] === "-r") continue;
    // First positional argument found
    if (args[i].startsWith("/")) {
      slashIdx = i;
    }
    break;
  }
  if (slashIdx === -1) return null;

  // Need at least /server and tool name
  if (slashIdx + 1 >= args.length) return null;

  const serverAlias = args[slashIdx].slice(1);
  const toolName = args[slashIdx + 1];
  const toolArgs = args.slice(slashIdx + 2);

  return { serverAlias, toolName, toolArgs };
}

/**
 * Parse a -p shorthand string into a SlashCommand.
 * Input: '/server tool --params \'{"key": "value"}\''
 */
export function parsePShorthand(input: string): SlashCommand | null {
  const tokens: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (ch === " " && !inSingle && !inDouble) {
      if (current) tokens.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);

  if (tokens.length < 2 || !tokens[0].startsWith("/")) return null;

  return {
    serverAlias: tokens[0].slice(1),
    toolName: tokens[1],
    toolArgs: tokens.slice(2),
  };
}
