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
