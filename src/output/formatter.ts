import Table from "cli-table3";
import chalk from "chalk";
import YAML from "yaml";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export type Format = "json" | "table" | "yaml" | "csv" | "markdown" | "auto";

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

    case "csv": {
      const lines: string[] = [];
      for (const item of result.content) {
        if (item.type === "text" && item.text) {
          try {
            const parsed = JSON.parse(item.text);
            if (Array.isArray(parsed)) {
              lines.push(formatArrayAsCsv(parsed));
            } else if (typeof parsed === "object" && parsed !== null) {
              // Single object as single-row CSV
              const keys = Object.keys(parsed);
              lines.push(keys.join(","));
              lines.push(keys.map((k) => escapeCsvField(displayValue((parsed as Record<string, unknown>)[k]))).join(","));
            } else {
              lines.push(String(parsed));
            }
          } catch {
            lines.push(item.text);
          }
        }
      }
      return lines.join("\n");
    }

    case "markdown": {
      const lines: string[] = [];
      for (const item of result.content) {
        if (item.type === "text" && item.text) {
          try {
            const parsed = JSON.parse(item.text);
            if (Array.isArray(parsed)) {
              lines.push(formatArrayAsMarkdown(parsed));
            } else if (typeof parsed === "object" && parsed !== null) {
              lines.push(formatObjectAsMarkdown(parsed as Record<string, unknown>));
            } else {
              lines.push(String(parsed));
            }
          } catch {
            lines.push(item.text);
          }
        }
      }
      return lines.join("\n\n");
    }

    default:
      return JSON.stringify(result, null, 2);
  }
}

function escapeCsvField(val: string): string {
  return val.includes(",") || val.includes("\n") || val.includes('"')
    ? `"${val.replace(/"/g, '""')}"`
    : val;
}

/** Stringify a value for display — JSON.stringify objects instead of [object Object] */
function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatArrayAsCsv(arr: unknown[]): string {
  if (arr.length === 0) return "";
  if (typeof arr[0] !== "object" || arr[0] === null) {
    return arr.map(String).join("\n");
  }
  const keys = Object.keys(arr[0] as Record<string, unknown>);
  const header = keys.join(",");
  const rows = arr.map((item) =>
    keys.map((k) => escapeCsvField(displayValue((item as Record<string, unknown>)[k]))).join(",")
  );
  return [header, ...rows].join("\n");
}

function formatArrayAsMarkdown(arr: unknown[]): string {
  if (arr.length === 0) return "(empty)";
  if (typeof arr[0] !== "object" || arr[0] === null) {
    return arr.map((v) => `- ${displayValue(v)}`).join("\n");
  }
  const keys = Object.keys(arr[0] as Record<string, unknown>);
  const header = `| ${keys.join(" | ")} |`;
  const separator = `| ${keys.map(() => "---").join(" | ")} |`;
  const rows = arr.map((item) =>
    `| ${keys.map((k) => displayValue((item as Record<string, unknown>)[k])).join(" | ")} |`
  );
  return [header, separator, ...rows].join("\n");
}

function formatObjectAsMarkdown(obj: Record<string, unknown>): string {
  return Object.entries(obj)
    .map(([key, value]) => `**${key}:** ${displayValue(value)}`)
    .join("\n");
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
      displayValue((item as Record<string, unknown>)[k])
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
    table.push({ [chalk.bold(key)]: displayValue(value) });
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

  if (resolved === "csv") {
    const header = "name,description,parameters";
    const rows = tools.map((t) => {
      const params = formatParams(t.inputSchema);
      return `${t.name},${escapeCsvField(t.description ?? "")},${escapeCsvField(params)}`;
    });
    return [header, ...rows].join("\n");
  }

  if (resolved === "markdown") {
    const lines = [
      "| Tool | Description | Parameters |",
      "| --- | --- | --- |",
    ];
    for (const t of tools) {
      const params = formatParams(t.inputSchema);
      lines.push(`| ${t.name} | ${t.description ?? ""} | ${params} |`);
    }
    return lines.join("\n");
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
