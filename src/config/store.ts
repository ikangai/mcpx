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
  mcpServers: Record<string, ServerConfig>;
  aliases?: Record<string, string>;
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
  const dir = getConfigDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(getServersPath(), JSON.stringify(config, null, 2) + "\n");
  cachedServers = config; // update cache after write
}

export function addServer(alias: string, command: string, env?: Record<string, string>): void {
  const config = loadServers();
  const parts = command.split(/\s+/);
  const server: ServerConfig = { command: parts[0], args: parts.slice(1) };
  if (env && Object.keys(env).length > 0) server.env = env;
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
