import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** Tool with typed annotations (MCP SDK types them as unknown) */
export interface AnnotatedTool extends Tool {
  annotations?: ToolAnnotations;
}
