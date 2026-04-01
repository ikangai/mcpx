import Table from "cli-table3";
import chalk from "chalk";
import YAML from "yaml";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export type Format = "json" | "table" | "yaml" | "auto";

export function detectFormat(explicit?: string): Format {
  if (explicit && explicit !== "auto") return explicit as Format;
  return process.stdout.isTTY ? "table" : "json";
}

export function formatResult(
  result: {
    content: Array<{
      type: string;
      text?: string;
      data?: string;
      mimeType?: string;
    }>;
    isError?: boolean;
  },
  format: Format
): string {
  const resolved = format === "auto" ? detectFormat() : format;

  switch (resolved) {
    case "json":
      return JSON.stringify(result, null, 2);

    case "yaml":
      return YAML.stringify(result);

    case "table": {
      const lines: string[] = [];
      for (const item of result.content) {
        if (item.type === "text" && item.text) {
          try {
            const parsed = JSON.parse(item.text);
            if (Array.isArray(parsed)) {
              lines.push(formatArrayAsTable(parsed));
            } else if (typeof parsed === "object" && parsed !== null) {
              lines.push(formatObjectAsTable(parsed));
            } else {
              lines.push(String(parsed));
            }
          } catch {
            lines.push(item.text);
          }
        } else if (item.type === "image") {
          lines.push(
            chalk.dim(
              `[Image: ${item.mimeType}, ${item.data?.length ?? 0} bytes base64]`
            )
          );
        } else if (item.type === "resource") {
          lines.push(chalk.dim(`[Resource]`));
        }
      }
      if (result.isError) {
        return chalk.red(lines.join("\n"));
      }
      return lines.join("\n");
    }

    default:
      return JSON.stringify(result, null, 2);
  }
}

function formatArrayAsTable(arr: unknown[]): string {
  if (arr.length === 0) return "(empty)";
  if (typeof arr[0] !== "object" || arr[0] === null) {
    return arr.map(String).join("\n");
  }
  const keys = Object.keys(arr[0] as Record<string, unknown>);
  const table = new Table({
    head: keys.map((k) => chalk.bold(k)),
    style: { head: [], border: [] },
  });
  for (const item of arr) {
    const row = keys.map((k) =>
      String((item as Record<string, unknown>)[k] ?? "")
    );
    table.push(row);
  }
  return table.toString();
}

function formatObjectAsTable(obj: Record<string, unknown>): string {
  const table = new Table({
    style: { head: [], border: [] },
  });
  for (const [key, value] of Object.entries(obj)) {
    table.push({ [chalk.bold(key)]: String(value) });
  }
  return table.toString();
}

export function formatToolList(tools: Tool[], format: Format): string {
  const resolved = format === "auto" ? detectFormat() : format;

  if (resolved === "json") {
    return JSON.stringify(tools, null, 2);
  }

  if (resolved === "yaml") {
    return YAML.stringify(tools);
  }

  const table = new Table({
    head: [
      chalk.bold("Tool"),
      chalk.bold("Description"),
      chalk.bold("Parameters"),
    ],
    style: { head: [], border: [] },
    wordWrap: true,
    colWidths: [25, 40, 50],
  });

  for (const tool of tools) {
    const params = formatParams(tool.inputSchema);
    table.push([tool.name, tool.description ?? "", params]);
  }

  return table.toString();
}

function formatParams(schema: Tool["inputSchema"]): string {
  const props = schema.properties ?? {};
  const required = new Set(
    (schema as { required?: string[] }).required ?? []
  );

  return Object.entries(props)
    .map(([name, prop]) => {
      const p = prop as { type?: string };
      const req = required.has(name) ? chalk.red("*") : "";
      return `${name}${req} (${p.type ?? "any"})`;
    })
    .join(", ");
}
