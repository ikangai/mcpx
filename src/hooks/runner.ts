import { execSync } from "node:child_process";
import { getHooks } from "../config/store.js";

const VALID_PATTERN = /^(before|after):[a-zA-Z0-9_-]+\.(\*|[a-zA-Z0-9_-]+)$/;

/**
 * Run hooks matching a pattern like "before:pg.execute_sql" or "after:pg.*"
 */
export function runHooks(
  phase: "before" | "after",
  server: string,
  tool: string,
  env?: Record<string, string>
): void {
  const hooks = getHooks();
  const fullName = `${server}.${tool}`;

  for (const [pattern, command] of Object.entries(hooks)) {
    // Skip hooks with invalid patterns
    if (!VALID_PATTERN.test(pattern)) continue;

    if (!pattern.startsWith(`${phase}:`)) continue;
    const target = pattern.slice(phase.length + 1);

    // Match: exact tool name, server.*, or global *
    const matches = target === fullName || target === `${server}.*`;
    if (!matches) continue;

    try {
      execSync(command, {
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 5000,
        env: { ...process.env, ...env, MCPX_SERVER: server, MCPX_TOOL: tool },
      });
    } catch { /* hook failure doesn't block execution */ }
  }
}
