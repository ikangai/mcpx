export interface JsonSchema {
  type: string;
  properties?: Record<string, PropertySchema>;
  required?: string[];
}

export interface PropertySchema {
  type?: string;
  description?: string;
  enum?: string[];
  items?: { type?: string };
  default?: unknown;
}

export function isSimpleType(prop: PropertySchema): boolean {
  const t = prop.type;
  return t === "string" || t === "number" || t === "integer" || t === "boolean";
}

export function isArrayOfPrimitives(prop: PropertySchema): boolean {
  return (
    prop.type === "array" &&
    !!prop.items?.type &&
    ["string", "number", "integer", "boolean"].includes(prop.items.type)
  );
}
