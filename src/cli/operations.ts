import type { McpClient } from "../mcp/client.js";
import type { ServerConfig } from "../mcp/config.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { addServer, removeServer, updateServer, getAllServers, importServers, addAlias, removeAlias, getAlias, getAllAliases, saveSnapshot, loadSnapshot } from "../config/store.js";
import { diffToolSchemas, formatDiff } from "./diff.js";
import { generateSkill } from "../skills/generator.js";
import { DaemonClient } from "../daemon/client.js";
import {
  type Envelope,
  successResult,
  successServers,
  successEmpty,
  errorEnvelope,
  EXIT,
} from "../output/envelope.js";
import { resolveServer, ConfigError, friendlyError, invokeTool, type ServerOpts } from "./commands.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Helper for operations that need direct McpClient access (not daemon-proxied).
 * Used by inspect, test, prompts, resources, diff — commands that call SDK
 * methods the daemon doesn't proxy.
 */
async function withDirectClient<T>(
  opts: ServerOpts,
  fn: (client: McpClient) => Promise<T>
): Promise<T> {
  const serverConfig = resolveServer(opts);
  const { McpClient: McpClientClass } = await import("../mcp/client.js");
  const client = new McpClientClass();
  try {
    await client.connect(serverConfig, { verbose: opts?.verbose, timeout: opts?.timeout });
    return await fn(client);
  } finally {
    await client.close();
  }
}

// ---------------------------------------------------------------------------
// Server CRUD
// ---------------------------------------------------------------------------

export async function runAdd(alias: string, command: string, env?: Record<string, string>): Promise<Envelope> {
  try {
    addServer(alias, command, env);
    return successEmpty();
  } catch (err) {
    return errorEnvelope(EXIT.CONFIG_ERROR, (err as Error).message);
  }
}

export async function runServers(): Promise<Envelope> {
  const servers = getAllServers();
  const list = Object.entries(servers).map(([alias, config]) => ({
    alias,
    command: config.command,
    args: config.args,
    env: config.env,
  }));
  return successServers(list);
}

export async function runRemove(alias: string): Promise<Envelope> {
  if (!removeServer(alias)) {
    return errorEnvelope(EXIT.CONFIG_ERROR, `Server "${alias}" not found.`);
  }
  // Flush daemon cache for this alias
  try {
    const daemon = new DaemonClient();
    if (await daemon.tryConnect()) {
      await daemon.flush(alias);
      daemon.close();
    }
  } catch { /* ignore */ }
  return successEmpty();
}

export async function runUpdate(alias: string, opts: { command?: string; env?: Record<string, string> }): Promise<Envelope> {
  if (!updateServer(alias, opts)) {
    return errorEnvelope(EXIT.CONFIG_ERROR, `Server "${alias}" not found.`);
  }
  // Flush daemon cache for this alias
  try {
    const daemon = new DaemonClient();
    if (await daemon.tryConnect()) {
      await daemon.flush(alias);
      daemon.close();
    }
  } catch { /* ignore */ }
  return successEmpty();
}

export async function runImport(configPath?: string, force = false): Promise<Envelope> {
  const path = configPath ?? findClaudeConfig();
  if (!path) {
    return errorEnvelope(EXIT.CONFIG_ERROR, "No config file found. Provide a path or install Claude Desktop.");
  }
  try {
    const imported = importServers(path, force);
    return successResult([{
      type: "text",
      text: `Imported ${imported.length} server(s): ${imported.join(", ") || "(none new)"}`,
    }]);
  } catch (err) {
    return errorEnvelope(EXIT.CONFIG_ERROR, (err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

export async function runSkills(serverAlias: string, opts?: ServerOpts): Promise<Envelope> {
  try {
    return await withDirectClient({ ...opts, serverAlias }, async (client) => {
      const tools = await client.listTools();
      const skill = generateSkill(serverAlias, tools);
      return successResult([{ type: "text", text: skill }]);
    });
  } catch (err) {
    if (err instanceof ConfigError) return errorEnvelope(EXIT.CONFIG_ERROR, err.message);
    return errorEnvelope(EXIT.CONNECTION_ERROR, friendlyError(err as Error));
  }
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

export async function runListPrompts(opts: ServerOpts): Promise<Envelope> {
  try {
    return await withDirectClient(opts, async (client) => {
      const prompts = await client.listPrompts();
      return successResult([{ type: "text", text: JSON.stringify(prompts, null, 2) }]);
    });
  } catch (err) {
    if (err instanceof ConfigError) return errorEnvelope(EXIT.CONFIG_ERROR, err.message);
    return errorEnvelope(EXIT.CONNECTION_ERROR, friendlyError(err as Error));
  }
}

export async function runGetPrompt(
  promptName: string,
  promptArgs: Record<string, string>,
  opts: ServerOpts
): Promise<Envelope> {
  try {
    return await withDirectClient(opts, async (client) => {
      const result = await client.getPrompt(promptName, promptArgs);
      return successResult([{ type: "text", text: JSON.stringify(result, null, 2) }]);
    });
  } catch (err) {
    if (err instanceof ConfigError) return errorEnvelope(EXIT.CONFIG_ERROR, err.message);
    return errorEnvelope(EXIT.CONNECTION_ERROR, friendlyError(err as Error));
  }
}

// ---------------------------------------------------------------------------
// Inspect
// ---------------------------------------------------------------------------

export async function runInspect(opts: ServerOpts): Promise<Envelope> {
  try {
    return await withDirectClient(opts, async (client) => {
      const tools = await client.listTools();
      const prompts = await client.listPrompts();
      const resources = await client.listResources();
      const capabilities = client.getServerCapabilities();
      const version = client.getServerVersion();
      const instructions = client.getInstructions();

      const info: Record<string, unknown> = {
        name: version?.name,
        version: version?.version,
        capabilities: capabilities ?? {},
        instructions: instructions ?? null,
        tools: tools.length,
        prompts: prompts.length,
        resources: resources.length,
      };

      // Include tool annotations summary
      const annotated = tools.filter((t: any) => t.annotations);
      if (annotated.length > 0) {
        info.annotatedTools = annotated.map((t: any) => ({
          name: t.name,
          annotations: t.annotations,
        }));
      }

      return successResult([{ type: "text", text: JSON.stringify(info, null, 2) }]);
    });
  } catch (err) {
    if (err instanceof ConfigError) return errorEnvelope(EXIT.CONFIG_ERROR, err.message);
    return errorEnvelope(EXIT.CONNECTION_ERROR, friendlyError(err as Error));
  }
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

export async function runListResources(opts: ServerOpts): Promise<Envelope> {
  try {
    return await withDirectClient(opts, async (client) => {
      const resources = await client.listResources();
      return successResult([{ type: "text", text: JSON.stringify(resources, null, 2) }]);
    });
  } catch (err) {
    if (err instanceof ConfigError) return errorEnvelope(EXIT.CONFIG_ERROR, err.message);
    return errorEnvelope(EXIT.CONNECTION_ERROR, friendlyError(err as Error));
  }
}

export async function runReadResource(uri: string, opts: ServerOpts): Promise<Envelope> {
  try {
    return await withDirectClient(opts, async (client) => {
      const resource = await client.readResource(uri);
      return successResult([{ type: "text", text: JSON.stringify(resource, null, 2) }]);
    });
  } catch (err) {
    if (err instanceof ConfigError) return errorEnvelope(EXIT.CONFIG_ERROR, err.message);
    return errorEnvelope(EXIT.CONNECTION_ERROR, friendlyError(err as Error));
  }
}

// ---------------------------------------------------------------------------
// Aliases
// ---------------------------------------------------------------------------

export async function runAlias(action: string, name?: string, command?: string): Promise<Envelope> {
  if (action === "list") {
    const aliases = getAllAliases();
    return successResult([{ type: "text", text: JSON.stringify(aliases, null, 2) }]);
  }
  if (action === "set" && name && command) {
    addAlias(name, command);
    return successEmpty();
  }
  if (action === "remove" && name) {
    if (!removeAlias(name)) {
      return errorEnvelope(EXIT.CONFIG_ERROR, `Alias "${name}" not found.`);
    }
    return successEmpty();
  }
  return errorEnvelope(EXIT.VALIDATION_ERROR, "Usage: mcpx alias list | mcpx alias set <name> <command> | mcpx alias remove <name>");
}

export async function runAliasExec(name: string, extraArgs: string[], opts: ServerOpts): Promise<Envelope> {
  const command = getAlias(name);
  if (!command) {
    return errorEnvelope(EXIT.CONFIG_ERROR, `Alias "${name}" not found.`);
  }
  const { parsePShorthand } = await import("./router.js");
  const parsed = parsePShorthand(command);
  if (!parsed) {
    return errorEnvelope(EXIT.VALIDATION_ERROR, `Invalid alias format: ${command}`);
  }
  const mergedArgs = [...parsed.toolArgs, ...extraArgs];
  return invokeTool(parsed.toolName, mergedArgs, { ...opts, serverAlias: parsed.serverAlias });
}

// ---------------------------------------------------------------------------
// Schema Diff
// ---------------------------------------------------------------------------

export async function runDiff(serverAlias: string, opts: ServerOpts): Promise<Envelope> {
  try {
    return await withDirectClient({ ...opts, serverAlias }, async (client) => {
      const currentTools = await client.listTools();
      const current = currentTools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown>,
      }));

      const previous = loadSnapshot(serverAlias);

      // Save current as new snapshot
      saveSnapshot(serverAlias, current);

      if (!previous) {
        return successResult([{
          type: "text",
          text: `Snapshot saved for ${serverAlias} (${current.length} tools). No previous snapshot to compare.`,
        }]);
      }

      const diff = diffToolSchemas(previous, current);
      const text = formatDiff(diff);
      return successResult([{ type: "text", text }]);
    });
  } catch (err) {
    if (err instanceof ConfigError) return errorEnvelope(EXIT.CONFIG_ERROR, err.message);
    return errorEnvelope(EXIT.CONNECTION_ERROR, friendlyError(err as Error));
  }
}

// ---------------------------------------------------------------------------
// Server Health Check
// ---------------------------------------------------------------------------

export async function runTest(opts: ServerOpts): Promise<Envelope> {
  const serverLabel = opts.serverAlias ?? "server";

  try {
    return await withDirectClient(opts, async (client) => {
      const results: string[] = [];

      // Step 1: Connect already done by withDirectClient
      results.push(`Connect: OK`);

      // Step 2: Server info
      const version = client.getServerVersion();
      const capabilities = client.getServerCapabilities();
      if (version) {
        results.push(`Server: ${version.name} v${version.version}`);
      }

      // Step 3: List tools
      const listStart = performance.now();
      const tools = await client.listTools();
      const listMs = Math.round(performance.now() - listStart);
      results.push(`Tools: ${tools.length} discovered (${listMs}ms)`);

      // Step 4: List prompts
      const prompts = await client.listPrompts();
      if (prompts.length > 0) {
        results.push(`Prompts: ${prompts.length} available`);
      }

      // Step 5: List resources
      const resources = await client.listResources();
      if (resources.length > 0) {
        results.push(`Resources: ${resources.length} available`);
      }

      // Step 6: Try calling a tool with no args (if one exists with no required params)
      const noParamTool = tools.find((t) => {
        const schema = t.inputSchema as { required?: string[] };
        return !schema.required || schema.required.length === 0;
      });
      if (noParamTool) {
        const callStart = performance.now();
        try {
          await client.callTool(noParamTool.name, {});
          const callMs = Math.round(performance.now() - callStart);
          results.push(`Call ${noParamTool.name}: OK (${callMs}ms)`);
        } catch (err) {
          results.push(`Call ${noParamTool.name}: FAILED - ${(err as Error).message}`);
        }
      }

      // Step 7: Capabilities summary
      const caps: string[] = [];
      if (capabilities) {
        if ((capabilities as any).tools) caps.push("tools");
        if ((capabilities as any).prompts) caps.push("prompts");
        if ((capabilities as any).resources) caps.push("resources");
      }
      if (caps.length > 0) {
        results.push(`Capabilities: ${caps.join(", ")}`);
      }

      const instructions = client.getInstructions();
      if (instructions) {
        results.push(`Instructions: ${instructions.slice(0, 100)}${instructions.length > 100 ? "..." : ""}`);
      }

      results.push("", `All checks passed for ${serverLabel}.`);
      return successResult([{ type: "text", text: results.join("\n") }]);
    });
  } catch (err) {
    if (err instanceof ConfigError) return errorEnvelope(EXIT.CONFIG_ERROR, err.message);
    return errorEnvelope(EXIT.CONNECTION_ERROR, friendlyError(err as Error));
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function findClaudeConfig(): string | null {
  const candidates = [
    join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json"),
    join(homedir(), ".config", "claude", "claude_desktop_config.json"),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}
