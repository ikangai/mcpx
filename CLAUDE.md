# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is mcpx?

A TypeScript CLI that transforms any MCP (Model Context Protocol) server into ergonomic CLI commands. It connects to an MCP server, discovers its tools, and exposes them as CLI commands with auto-generated flags from JSON Schema.

## Commands

```bash
npm run build        # Compile TypeScript to dist/
npm run dev          # Run via tsx (no build needed)
npm test             # Run all tests (vitest)
npm run test:watch   # Watch mode
npx vitest run path/to/test.ts  # Run a single test file
```

## Architecture

Three layers:

1. **CLI Layer** (`src/index.ts`, `src/cli/`) — commander.js entry point, routes to `exec`, `list`, `interactive` modes
2. **Bridge Layer** (`src/mcp/`, `src/cli/flags.ts`, `src/output/`) — MCP protocol interaction, JSON Schema-to-flags generation, output formatting
3. **MCP SDK** (`@modelcontextprotocol/sdk`) — transport and JSON-RPC protocol

Key flow for `exec`: parse CLI args -> connect to MCP server -> discover tools via `tools/list` -> dynamically build commander flags from tool's `inputSchema` -> call `tools/call` -> format output.

### Module responsibilities

- `src/mcp/client.ts` — `McpClient` wraps the SDK: connect, listTools (paginated), callTool, close
- `src/mcp/config.ts` — parses inline server commands (`-s`) and config files (`-c`) matching Claude Desktop format
- `src/cli/flags.ts` — converts JSON Schema properties into commander `Option` instances; `parseToolArgs` reassembles flags back into a tool arguments object. `--json` escape hatch for complex nested inputs
- `src/cli/commands.ts` — `runExec` and `runList` orchestrate the full flow
- `src/interactive/repl.ts` — REPL mode with inquirer prompts, tool search, and command-line echo
- `src/output/formatter.ts` — auto-detects TTY for table vs JSON; supports json/table/yaml formats
- `src/utils/schema.ts` — JSON Schema type guards

### Test structure

- `src/**/__tests__/*.test.ts` — unit tests (config parser, flags generator, formatter)
- `test/integration/` — end-to-end tests using a real MCP server (`test-server.ts` with 3 tools: greet, add, fail)

## Key design decisions

- Flags are generated dynamically from MCP tool schemas at runtime (like Google Workspace CLI's approach with API Discovery Documents)
- `object`-typed properties are skipped in flag generation — users must use `--json` for nested inputs
- `makeOptionMandatory()` is intentionally not used because it conflicts with the `--json` escape hatch
- Config file format matches Claude Desktop's `mcpServers` convention for reusability
- Interactive mode echoes the equivalent `mcpx exec` command after each invocation
