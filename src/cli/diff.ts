import type { ToolInfo } from "../output/envelope.js";

export interface SchemaDiff {
  added: string[];
  removed: string[];
  changed: Array<{
    tool: string;
    changes: string[];
  }>;
}

export function diffToolSchemas(before: ToolInfo[], after: ToolInfo[]): SchemaDiff {
  const beforeMap = new Map(before.map((t) => [t.name, t]));
  const afterMap = new Map(after.map((t) => [t.name, t]));

  const added = after.filter((t) => !beforeMap.has(t.name)).map((t) => t.name);
  const removed = before.filter((t) => !afterMap.has(t.name)).map((t) => t.name);

  const changed: SchemaDiff["changed"] = [];
  for (const [name, afterTool] of afterMap) {
    const beforeTool = beforeMap.get(name);
    if (!beforeTool) continue;

    const changes: string[] = [];

    // Compare descriptions
    if (beforeTool.description !== afterTool.description) {
      changes.push(`description: "${beforeTool.description}" -> "${afterTool.description}"`);
    }

    // Compare input schemas
    const beforeSchema = JSON.stringify(beforeTool.inputSchema);
    const afterSchema = JSON.stringify(afterTool.inputSchema);
    if (beforeSchema !== afterSchema) {
      const bp = (beforeTool.inputSchema as any).properties ?? {};
      const ap = (afterTool.inputSchema as any).properties ?? {};
      const allProps = new Set([...Object.keys(bp), ...Object.keys(ap)]);
      for (const prop of allProps) {
        if (!bp[prop]) changes.push(`+ added param: ${prop}`);
        else if (!ap[prop]) changes.push(`- removed param: ${prop}`);
        else if (JSON.stringify(bp[prop]) !== JSON.stringify(ap[prop])) {
          changes.push(`~ changed param: ${prop}`);
        }
      }

      // Compare required fields
      const br = new Set((beforeTool.inputSchema as any).required ?? []);
      const ar = new Set((afterTool.inputSchema as any).required ?? []);
      for (const r of ar) { if (!br.has(r)) changes.push(`+ newly required: ${r}`); }
      for (const r of br) { if (!ar.has(r)) changes.push(`- no longer required: ${r}`); }
    }

    if (changes.length > 0) {
      changed.push({ tool: name, changes });
    }
  }

  return { added, removed, changed };
}

export function formatDiff(diff: SchemaDiff): string {
  const lines: string[] = [];

  if (diff.added.length > 0) {
    lines.push("Added tools:");
    diff.added.forEach((t) => lines.push(`  + ${t}`));
    lines.push("");
  }

  if (diff.removed.length > 0) {
    lines.push("Removed tools:");
    diff.removed.forEach((t) => lines.push(`  - ${t}`));
    lines.push("");
  }

  if (diff.changed.length > 0) {
    lines.push("Changed tools:");
    for (const { tool, changes } of diff.changed) {
      lines.push(`  ~ ${tool}:`);
      changes.forEach((c) => lines.push(`    ${c}`));
    }
    lines.push("");
  }

  if (lines.length === 0) {
    lines.push("No changes detected.");
  }

  return lines.join("\n");
}
