import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ServerConfig } from "../mcp/config.js";
import type { ToolInfo } from "../output/envelope.js";

function getConfigDir(): string {
  return process.env.MCPX_CONFIG_DIR ?? join(homedir(), ".config", "mcpx");
}

function getServersPath(): string {
  return join(getConfigDir(), "servers.json");
}

export interface ServersFile {
  version?: number; // config format version
  mcpServers: Record<string, ServerConfig>;
  aliases?: Record<string, string>;
  hooks?: Record<string, string>; // pattern -> shell command
}

// In-process cache to avoid repeated disk reads within a single CLI invocation
let cachedServers: ServersFile | null = null;

export function loadServers(): ServersFile {
  if (cachedServers) return cachedServers;
  const path = getServersPath();
  if (!existsSync(path)) {
    cachedServers = { mcpServers: {} };
    return cachedServers;
  }
  try {
    const raw = readFileSync(path, "utf-8");
    cachedServers = JSON.parse(raw) as ServersFile;
    return cachedServers;
  } catch {
    cachedServers = { mcpServers: {} };
    return cachedServers;
  }
}

export function saveServers(config: ServersFile): void {
  config.version = 1; // always write latest version
  const dir = getConfigDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(getServersPath(), JSON.stringify(config, null, 2) + "\n");
  cachedServers = config; // update cache after write
}

export function addServer(
  alias: string,
  command: string,
  env?: Record<string, string>,
  httpOpts?: { url?: string; transport?: "stdio" | "sse" | "http"; headers?: Record<string, string>; oauth?: { clientId: string; clientSecret: string; scope?: string } },
): void {
  if (!alias.trim()) throw new Error("Server alias cannot be empty");
  const config = loadServers();
  let server: ServerConfig;

  if (httpOpts?.url) {
    server = { url: httpOpts.url };
    if (httpOpts.transport) server.transport = httpOpts.transport;
    if (httpOpts.headers && Object.keys(httpOpts.headers).length > 0) server.headers = httpOpts.headers;
    if (httpOpts.oauth) server.oauth = httpOpts.oauth;
  } else {
    if (!command.trim()) throw new Error("Server command cannot be empty");
    const parts = command.split(/\s+/).filter(Boolean);
    server = { command: parts[0], args: parts.slice(1) };
    if (env && Object.keys(env).length > 0) server.env = env;
  }

  config.mcpServers[alias] = server;
  saveServers(config);
}

export function getServer(alias: string): ServerConfig | undefined {
  const config = loadServers();
  return config.mcpServers[alias];
}

export function getAllServers(): Record<string, ServerConfig> {
  return loadServers().mcpServers;
}

export function importServers(configPath: string, force = false): string[] {
  const raw = readFileSync(configPath, "utf-8");
  const external = JSON.parse(raw) as ServersFile;
  const current = loadServers();
  const imported: string[] = [];
  for (const [alias, config] of Object.entries(external.mcpServers ?? {})) {
    if (force || !(alias in current.mcpServers)) {
      current.mcpServers[alias] = config;
      imported.push(alias);
    }
  }
  saveServers(current);
  return imported;
}

export function updateServer(alias: string, updates: {
  command?: string;
  env?: Record<string, string>;
}): boolean {
  const config = loadServers();
  const server = config.mcpServers[alias];
  if (!server) return false;

  if (updates.command) {
    const parts = updates.command.split(/\s+/);
    server.command = parts[0];
    server.args = parts.slice(1);
  }
  if (updates.env) {
    server.env = { ...server.env, ...updates.env };
  }

  saveServers(config);
  return true;
}

export function removeServer(alias: string): boolean {
  const config = loadServers();
  if (!(alias in config.mcpServers)) return false;
  delete config.mcpServers[alias];
  saveServers(config);
  return true;
}

// ---------------------------------------------------------------------------
// Aliases
// ---------------------------------------------------------------------------

export function addAlias(name: string, command: string): void {
  const config = loadServers();
  if (!config.aliases) config.aliases = {};
  config.aliases[name] = command;
  saveServers(config);
}

export function removeAlias(name: string): boolean {
  const config = loadServers();
  if (!config.aliases || !(name in config.aliases)) return false;
  delete config.aliases[name];
  saveServers(config);
  return true;
}

export function getAlias(name: string): string | undefined {
  const config = loadServers();
  return config.aliases?.[name];
}

export function getAllAliases(): Record<string, string> {
  return loadServers().aliases ?? {};
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function addHook(pattern: string, command: string): void {
  const validPattern = /^(before|after):[a-zA-Z0-9_-]+\.(\*|[a-zA-Z0-9_-]+)$/;
  if (!validPattern.test(pattern)) {
    throw new Error(`Invalid hook pattern: "${pattern}". Expected format: before:server.tool or after:server.*`);
  }
  const config = loadServers();
  if (!config.hooks) config.hooks = {};
  config.hooks[pattern] = command;
  saveServers(config);
}

export function removeHook(pattern: string): boolean {
  const config = loadServers();
  if (!config.hooks || !(pattern in config.hooks)) return false;
  delete config.hooks[pattern];
  saveServers(config);
  return true;
}

export function getHooks(): Record<string, string> {
  return loadServers().hooks ?? {};
}

// ---------------------------------------------------------------------------
// Snapshots (for schema diff)
// ---------------------------------------------------------------------------

export function saveSnapshot(alias: string, tools: ToolInfo[]): void {
  const dir = getConfigDir();
  mkdirSync(join(dir, "snapshots"), { recursive: true });
  writeFileSync(join(dir, "snapshots", `${alias}.json`), JSON.stringify(tools, null, 2));
}

export function loadSnapshot(alias: string): ToolInfo[] | null {
  const path = join(getConfigDir(), "snapshots", `${alias}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}
