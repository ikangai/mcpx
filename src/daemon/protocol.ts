export interface DaemonRequest {
  id: number;
  method: "listTools" | "callTool" | "ping" | "shutdown" | "flush";
  serverAlias: string;
  serverConfig?: {
    command: string;
    args: string[];
    env?: Record<string, string>;
  };
  toolName?: string;
  toolArgs?: Record<string, unknown>;
}

export interface DaemonResponse {
  id: number;
  result?: unknown;
  error?: string;
}
