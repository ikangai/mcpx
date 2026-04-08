# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-04-08

Initial public release.

### Features

- **Slash-command routing** -- `mcpx /server tool --flag value` as the primary invocation pattern
- **Dynamic flag generation** -- auto-generates CLI flags from MCP tool JSON Schema at runtime
- **Connection daemon** -- background process pools MCP server connections over Unix sockets (Windows named pipes), auto-starts on first use, auto-exits after 5 min idle
- **Server registry** -- `add`, `remove`, `update`, `import` commands with persistent config at `~/.config/mcpx/servers.json`
- **Structured JSON envelope output** -- all commands return `{ ok, result?, tools?, error? }` for agent consumption
- **Multiple output formats** -- `--format json|table|yaml|csv|markdown` with auto-detect TTY
- **Raw output mode** -- `-r` / `--raw` strips envelope for piping and scripting
- **Interactive REPL** -- `mcpx interactive` with fuzzy search, per-field prompts, and command echo
- **MCP gateway** -- `mcpx serve` aggregates all registered servers into a single MCP endpoint (stdio or HTTP)
- **YAML workflows** -- `mcpx workflow` runs sequential multi-server tool chains with `{{variable}}` interpolation
- **Middleware hooks** -- `before:` / `after:` pattern-matched shell commands on tool calls
- **NDJSON audit logging** -- `--log` flag appends tool invocations with timing for observability
- **Schema diffing** -- `mcpx diff` compares current tool schemas against saved snapshots
- **Batch mode** -- `mcpx batch` reads NDJSON from stdin for bulk tool calls
- **Watch/poll** -- `mcpx watch <interval>` re-executes tools on a schedule
- **Full MCP protocol surface** -- `inspect`, `prompts`, `resources` commands
- **Server health checks** -- `mcpx test` verifies connectivity with latency reporting
- **Agent skill generation** -- `mcpx skills` produces markdown documentation for any server
- **Short alias** -- `mx` as a shorter alternative to `mcpx`
- **Semantic exit codes** -- 0 (success), 1 (tool error), 2 (connection), 3 (validation), 4 (config), 5 (internal)
- **Result caching** -- daemon caches responses for tools with `readOnlyHint` / `idempotentHint` annotations (30s TTL)
- **Cross-platform** -- macOS, Linux, Windows (named pipes)

### Performance

- Lazy-import MCP SDK to eliminate 59ms from module load
- Single-tool gateway pattern reduces token overhead by 95% for `mcpx serve`
- Daemon connection reuse is ~39% faster than direct MCP server spawning
