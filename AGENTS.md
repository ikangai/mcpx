# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What is mcpx?

A TypeScript CLI that transforms any MCP (Model Context Protocol) server into ergonomic CLI commands. It connects to MCP servers, discovers their tools, and exposes them as CLI commands with auto-generated flags from JSON Schema. Supports slash-command routing (`mcpx /server tool`), a persistent connection daemon, a config store for registered servers, and structured envelope output for both human and agent consumption.

## Commands

```bash
npm run build        # Compile TypeScript to dist/
npm run dev          # Run via tsx (no build needed)
npm test             # Run all tests (vitest)
npm run test:watch   # Watch mode
npx vitest run path/to/test.ts  # Run a single test file
```

For development with slash commands:
```bash
npx tsx src/index.ts /server tool --params '{"key": "value"}'
npx tsx src/index.ts list /server
npx tsx src/index.ts add myserver "npx some-mcp-server"
npx tsx src/index.ts servers
```

## Architecture

Four layers:

1. **CLI Layer** (`src/index.ts`, `src/cli/`) — commander.js entry point with slash-command routing, `-p` shorthand, and subcommands (`exec`, `list`, `add`, `remove`, `update`, `servers`, `import`, `schema`, `skills`, `interactive`, `daemon`)
2. **Bridge Layer** (`src/mcp/`, `src/cli/flags.ts`, `src/output/`) — MCP protocol interaction, JSON Schema-to-flags generation, envelope output, and human-friendly formatting
3. **Daemon Layer** (`src/daemon/`) — persistent background process that pools MCP server connections over a Unix socket (or Windows named pipe), with idle timeout auto-shutdown
4. **Config Layer** (`src/config/`) — JSON file store for registered servers at `~/.config/mcpx/servers.json`

Key flow for slash commands: `mcpx /server tool --flag value` -> router extracts server alias + tool name -> resolve server config from store -> connect via daemon (or direct) -> discover tools via `tools/list` -> dynamically build commander flags from tool's `inputSchema` -> call `tools/call` -> wrap in envelope -> output.

### Module responsibilities

- `src/index.ts` — CLI entry point; loads `.env`, wires all commander subcommands, handles slash-command and `-p` shorthand routing, `emitOutput` for `--format` flag
- `src/cli/commands.ts` — `invokeTool`, `listTools`, `runAdd`, `runRemove`, `runUpdate`, `runServers`, `runImport`, `runSkills`, `getToolSchema`; orchestrates server resolution, daemon-or-direct connection via `withServer`, and envelope construction
- `src/cli/router.ts` — `parseSlashCommand` and `parsePShorthand`: extract `/server tool args` patterns from argv
- `src/cli/flags.ts` — converts JSON Schema properties into commander `Option` instances; `parseToolArgs` reassembles flags back into a tool arguments object. `--json` escape hatch for complex nested inputs
- `src/mcp/client.ts` — `McpClient` wraps the SDK: connect (with timeout), listTools (paginated), callTool, close
- `src/mcp/config.ts` — `ServerConfig` type, `parseServerSpec` (inline `-s` commands), `parseConfigFile` (Codex Desktop format)
- `src/config/store.ts` — `loadServers`, `saveServers`, `addServer`, `updateServer`, `removeServer`, `getServer`, `getAllServers`, `importServers`; persists to `~/.config/mcpx/servers.json` (overridable via `MCPX_CONFIG_DIR`)
- `src/daemon/server.ts` — background daemon process; `ConnectionPool` caches MCP client connections; listens on Unix socket / Windows named pipe; auto-shuts down after 5 min idle
- `src/daemon/client.ts` — `DaemonClient` connects to the daemon socket, auto-starts daemon if not running; methods: `listTools`, `callTool`, `ping`, `shutdown`
- `src/daemon/protocol.ts` — `DaemonRequest` / `DaemonResponse` message types (JSON-RPC-like over newline-delimited JSON)
- `src/output/envelope.ts` — `Envelope` type (`SuccessEnvelope | ErrorEnvelope`), factory functions (`successResult`, `successTools`, `successSchema`, `successServers`, `successEmpty`, `errorEnvelope`), `output()` writes JSON to stdout and exits
- `src/output/formatter.ts` — `formatResult` and `formatToolList` with auto-detect TTY; supports json/table/yaml formats using cli-table3 and chalk
- `src/interactive/repl.ts` — REPL mode with inquirer search prompt, per-field input prompts, and command-line echo of equivalent `mcpx exec` command
- `src/skills/generator.ts` — `generateSkill` produces markdown documentation for a server's tools with usage examples and parameter tables
- `src/utils/schema.ts` — `JsonSchema`/`PropertySchema` types, `isSimpleType`, `isArrayOfPrimitives` type guards
- `src/serve/gateway.ts` — MCP gateway server; connects to all registered servers and re-exposes their tools with namespaced names (`alias.toolName`) via stdio or HTTP transport
- `src/workflows/runner.ts` — YAML workflow runner; sequential multi-server tool chains with variable interpolation
- `src/hooks/runner.ts` — middleware hooks; runs shell commands before/after tool calls with pattern matching
- `src/audit/logger.ts` — NDJSON audit logger; appends tool invocations with timing to a log file
- `src/cli/diff.ts` — schema diff; compares current tool schemas against saved snapshots

### Test structure

- `src/**/__tests__/*.test.ts` — unit tests (config parser, flags generator, formatter, envelope, router, store)
- `test/integration/` — end-to-end tests using a real MCP server (`test-server.ts` with 3 tools: greet, add, fail)
- `test/evals/` — LLM-eval-style tests covering discovery, schema, invocation, output formatting, and end-to-end flows (use `helpers.ts` for common setup)
- `test/evals/advanced.test.ts` — tests for inspect, test, params-stdin, field, csv, markdown, alias, hook, log, diff, workflow, prompts, resources

## Key design decisions

- **Envelope output**: all commands return a structured `Envelope` JSON object (`{ ok, result?, tools?, schema?, servers?, error? }`). The `--format` flag unwraps envelopes into human-friendly table/yaml for TTY use; default JSON is agent-facing
- **Slash routing**: `mcpx /server tool` is the primary invocation pattern, parsed before commander runs. The `-p` shorthand (`mcpx -p "/server tool --params '{}'"`) provides a single-string alternative
- **Daemon caching**: `withServer` in commands.ts first tries the daemon for cached connections (when a server alias is available), falling back to direct connection. The daemon auto-starts on first use and auto-stops after 5 min idle
- **Store persistence**: `servers.json` in `MCPX_CONFIG_DIR` (default `~/.config/mcpx/`) uses the same `mcpServers` format as Codex Desktop config for easy `import`
- **Dynamic flags**: generated at runtime from MCP tool schemas; `object`-typed properties are skipped (users must use `--json`/`--params` for nested inputs)
- **`makeOptionMandatory()` not used**: intentionally omitted because it conflicts with the `--json`/`--params` escape hatch
- **Windows compatibility**: daemon uses named pipes on Windows (`\\.\pipe\mcpx-...`) instead of Unix sockets
- **Audit logging**: `--log` appends NDJSON records (server, tool, params, exitCode, durationMs) for production observability
- **Hooks**: before/after patterns (`before:server.*`, `after:server.tool`) with 5s timeout, silent failures — hooks never block tool execution
- **Workflows**: YAML-based sequential steps with `{{variable}}` interpolation between steps — fails fast on first error
- **HTTP gateway**: `mcpx serve --port N` exposes JSON-RPC endpoint at `/mcp` and health check at `/health` — no authentication by default (bind to localhost for security)
- **Result caching**: daemon caches results for tools with `readOnlyHint` or `idempotentHint` annotations (30s TTL)
- **Output formats**: `--format csv|markdown` in addition to json/table/yaml — CSV escapes fields with commas/quotes, markdown produces GFM tables
