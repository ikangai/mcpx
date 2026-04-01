import { Command, Option } from "commander";
import type { JsonSchema } from "../utils/schema.js";
import { isSimpleType, isArrayOfPrimitives } from "../utils/schema.js";

export function addToolFlags(cmd: Command, schema: JsonSchema): void {
  const props = schema.properties ?? {};

  for (const [name, prop] of Object.entries(props)) {
    if (prop.type === "object") continue;

    if (prop.type === "boolean") {
      const opt = new Option(`--${name}`, prop.description);
      cmd.addOption(opt);
      continue;
    }

    if (isArrayOfPrimitives(prop)) {
      const opt = new Option(`--${name} <value>`, prop.description);
      opt.argParser((val: string, prev: string[] | undefined) => {
        const arr = prev ?? [];
        arr.push(val);
        return arr;
      });
      cmd.addOption(opt);
      continue;
    }

    if (isSimpleType(prop)) {
      const opt = new Option(`--${name} <value>`, prop.description);

      if (prop.enum) {
        opt.choices(prop.enum);
      }

      if (prop.type === "number" || prop.type === "integer") {
        opt.argParser((val: string) => {
          const n = Number(val);
          if (isNaN(n)) throw new Error(`"${name}" must be a number`);
          return n;
        });
      }

      cmd.addOption(opt);
    }
  }

  cmd.addOption(
    new Option("--json <json>", "Pass all arguments as a JSON string")
  );
}

export function parseToolArgs(
  opts: Record<string, unknown>,
  schema: JsonSchema
): Record<string, unknown> {
  if (opts.json && typeof opts.json === "string") {
    return JSON.parse(opts.json);
  }

  const result: Record<string, unknown> = {};
  const propNames = new Set(Object.keys(schema.properties ?? {}));

  for (const [key, value] of Object.entries(opts)) {
    if (key === "json") continue;
    if (value === undefined) continue;
    if (propNames.has(key)) {
      result[key] = value;
    }
  }
  return result;
}
