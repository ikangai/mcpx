export interface ServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface McpxConfig {
  mcpServers: Record<string, ServerConfig>;
}

export function parseServerSpec(spec: string): ServerConfig {
  const parts = spec.split(/\s+/);
  return {
    command: parts[0],
    args: parts.slice(1),
  };
}

export function parseConfigFile(
  config: McpxConfig,
  serverName?: string
): ServerConfig {
  const names = Object.keys(config.mcpServers);

  if (serverName) {
    const server = config.mcpServers[serverName];
    if (!server) {
      throw new Error(
        `Server "${serverName}" not found in config. Available: ${names.join(", ")}`
      );
    }
    return server;
  }

  if (names.length === 1) {
    return config.mcpServers[names[0]];
  }

  throw new Error(
    `Multiple servers in config. Specify one with --server-name: ${names.join(", ")}`
  );
}
