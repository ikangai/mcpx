import type { Tool } from "@modelcontextprotocol/sdk/types.js";

interface JsonSchemaProperty {
  type?: string;
  description?: string;
  default?: unknown;
  enum?: string[];
}

interface JsonSchemaObj {
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

export function generateSkill(alias: string, tools: Tool[]): string {
  const lines = [
    `# ${alias} — MCP Server Skill`,
    "",
    `Use \`mcpx\` to interact with the **${alias}** server.`,
    "",
    "## Setup",
    "",
    "```bash",
    `mcpx list /${alias}              # list all tools`,
    `mcpx schema /${alias} <tool>     # show tool schema`,
    `mcpx /${alias} <tool> --help     # show usage`,
    `mcpx /${alias} <tool> --dry-run  # preview without executing`,
    "```",
    "",
    `## Tools (${tools.length})`,
    "",
  ];

  for (const tool of tools) {
    const schema = tool.inputSchema as JsonSchemaObj;
    const props = schema.properties ?? {};
    const required = new Set(schema.required ?? []);

    lines.push(`### ${tool.name}`);
    lines.push("");
    if (tool.description) lines.push(tool.description);
    lines.push("");

    // Build example params
    const exampleParams: Record<string, unknown> = {};
    for (const [name, prop] of Object.entries(props)) {
      if (required.has(name)) {
        if (prop.type === "string") exampleParams[name] = `<${name}>`;
        else if (prop.type === "number" || prop.type === "integer") exampleParams[name] = 0;
        else if (prop.type === "boolean") exampleParams[name] = false;
      }
    }

    lines.push("```bash");
    if (Object.keys(exampleParams).length > 0) {
      lines.push(`mcpx /${alias} ${tool.name} --params '${JSON.stringify(exampleParams)}'`);
    } else {
      lines.push(`mcpx /${alias} ${tool.name}`);
    }
    lines.push("```");
    lines.push("");

    // List parameters
    if (Object.keys(props).length > 0) {
      lines.push("| Parameter | Type | Required | Description |");
      lines.push("|-----------|------|----------|-------------|");
      for (const [name, prop] of Object.entries(props)) {
        const req = required.has(name) ? "Yes" : "No";
        const desc = prop.description ?? "";
        lines.push(`| \`${name}\` | ${prop.type ?? "any"} | ${req} | ${desc} |`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}
