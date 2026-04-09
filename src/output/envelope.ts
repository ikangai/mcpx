export interface ServerInfo {
  alias: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  transport?: string;
  headers?: string;
  oauth?: string;
}

export interface SuccessEnvelope {
  ok: true;
  result?: ContentItem[];
  tools?: ToolInfo[];
  schema?: Record<string, unknown>;
  servers?: ServerInfo[];
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
  annotations?: Record<string, unknown>;
}

/** Exit codes matching gws convention */
export const EXIT = {
  SUCCESS: 0,
  TOOL_ERROR: 1,
  CONNECTION_ERROR: 2,
  VALIDATION_ERROR: 3,
  CONFIG_ERROR: 4,
  INTERNAL_ERROR: 5,
  TIMEOUT: 124,
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

export function successServers(servers: ServerInfo[]): SuccessEnvelope {
  return { ok: true, servers };
}

export function successEmpty(): SuccessEnvelope {
  return { ok: true };
}

export function errorEnvelope(code: number, message: string): ErrorEnvelope {
  return { ok: false, error: { code, message } };
}

/**
 * Write envelope to stdout and exit with the appropriate code.
 * All CLI output goes through this function.
 */
export function output(envelope: Envelope, raw = false): never {
  if (raw) {
    outputRaw(envelope);
  } else {
    console.log(JSON.stringify(envelope, null, 2));
  }
  const code = envelope.ok ? EXIT.SUCCESS : envelope.error.code;
  process.exit(code);
}

/**
 * Raw output mode — strips the envelope, outputs just the content.
 * Saves ~35% tokens when used by agents via Bash tool.
 * Errors go to stderr, content to stdout.
 */
function outputRaw(envelope: Envelope): void {
  if (!envelope.ok) {
    console.error(envelope.error.message);
    return;
  }
  if (envelope.result) {
    for (const item of envelope.result) {
      if (item.type === "text" && item.text) {
        console.log(item.text);
      } else if (item.type === "image") {
        console.log(`[image: ${item.mimeType}]`);
      }
    }
  } else if (envelope.tools) {
    for (const tool of envelope.tools) {
      console.log(`${tool.name}\t${tool.description ?? ""}`);
    }
  } else if (envelope.schema) {
    console.log(JSON.stringify(envelope.schema, null, 2));
  } else if (envelope.servers) {
    for (const s of envelope.servers) {
      console.log(`${s.alias}\t${s.url ?? `${s.command ?? ""} ${(s.args ?? []).join(" ")}`}`);
    }
  }
  // Empty success: no output (exit 0 is enough)
}
