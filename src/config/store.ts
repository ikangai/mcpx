import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ServerConfig } from "../mcp/config.js";

function getConfigDir(): string {
  return process.env.MCPX_CONFIG_DIR ?? join(homedir(), ".config", "mcpx");
}

function getServersPath(): string {
  return join(getConfigDir(), "servers.json");
}

export interface ServersFile {
  mcpServers: Record<string, ServerConfig>;
}

export function loadServers(): ServersFile {
  const path = getServersPath();
  if (!existsSync(path)) {
    return { mcpServers: {} };
  }
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as ServersFile;
}

export function saveServers(config: ServersFile): void {
  const dir = getConfigDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(getServersPath(), JSON.stringify(config, null, 2) + "\n");
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

export function removeServer(alias: string): boolean {
  const config = loadServers();
  if (!(alias in config.mcpServers)) return false;
  delete config.mcpServers[alias];
  saveServers(config);
  return true;
}
