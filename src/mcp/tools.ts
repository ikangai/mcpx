import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export function buildToolIndex(tools: Tool[]): Map<string, Tool> {
  return new Map(tools.map(t => [t.name, t]));
}
