import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

let logPath: string | null = null;

export function setLogPath(path: string): void {
  logPath = path;
  mkdirSync(dirname(path), { recursive: true });
}

export function logInvocation(entry: {
  server: string;
  tool: string;
  params: Record<string, unknown>;
  exitCode: number;
  durationMs: number;
}): void {
  if (!logPath) return;
  const record = {
    ts: new Date().toISOString(),
    ...entry,
  };
  try {
    appendFileSync(logPath, JSON.stringify(record) + "\n");
  } catch { /* best effort */ }
}
