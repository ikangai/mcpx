export interface SuccessEnvelope {
  ok: true;
  result?: ContentItem[];
  tools?: ToolInfo[];
  schema?: Record<string, unknown>;
}

export interface ErrorEnvelope {
  ok: false;
  error: { code: number; message: string };
}

export type Envelope = SuccessEnvelope | ErrorEnvelope;

export interface ContentItem {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  server?: string;
}

/** Exit codes matching gws convention */
export const EXIT = {
  SUCCESS: 0,
  TOOL_ERROR: 1,
  CONNECTION_ERROR: 2,
  VALIDATION_ERROR: 3,
  CONFIG_ERROR: 4,
  INTERNAL_ERROR: 5,
} as const;

export function successResult(content: ContentItem[]): SuccessEnvelope {
  return { ok: true, result: content };
}

export function successTools(tools: ToolInfo[]): SuccessEnvelope {
  return { ok: true, tools };
}

export function successSchema(schema: Record<string, unknown>): SuccessEnvelope {
  return { ok: true, schema };
}

export function errorEnvelope(code: number, message: string): ErrorEnvelope {
  return { ok: false, error: { code, message } };
}

/**
 * Write envelope to stdout and exit with the appropriate code.
 * All CLI output goes through this function.
 */
export function output(envelope: Envelope): never {
  console.log(JSON.stringify(envelope, null, 2));
  const code = envelope.ok ? EXIT.SUCCESS : envelope.error.code;
  process.exit(code);
}
