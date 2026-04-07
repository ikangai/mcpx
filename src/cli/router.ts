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

export function parseSlashCommand(argv: string[]): SlashCommand | null {
  // Skip node and script path (argv[0], argv[1])
  const args = argv.slice(2);

  if (args.length < 2) return null;

  const first = args[0];
  if (!first.startsWith("/")) return null;

  const serverAlias = first.slice(1); // strip leading /
  const toolName = args[1];
  const toolArgs = args.slice(2);

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
