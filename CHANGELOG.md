# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Features

- **HTTP/SSE transport** -- connect to remote MCP servers over HTTP (Streamable HTTP) and SSE, not just stdio
- **Authentication** -- static Bearer tokens via `-H` header flag, custom headers, and OAuth client_credentials flow via `--oauth-*` flags
- **Transport selection** -- auto-detects HTTP vs stdio from URL; explicit `--transport sse|http|stdio` override available
- **Friendly HTTP errors** -- 401/403/network failures produce actionable messages instead of raw errors
- **Parallel batch execution** -- `mcpx batch /server --parallel N` executes up to N tool calls concurrently from NDJSON stdin, preserving output order
- **Pipe-friendly `--field`** -- `--field` auto-implies `--raw` when stdout is not a TTY, so piped output is just the extracted value (no envelope)
- **Timeout exit code 124** -- timeouts now return exit code 124 (GNU `timeout` convention) instead of generic connection error (2), letting agents distinguish slow servers from down servers
- **Connection health checks** -- daemon health-checks stale connections (idle >60s) before reuse and auto-reconnects dead ones

### Performance

- **O(1) tool lookup** -- daemon ConnectionPool stores a `Map<string, Tool>` index alongside tool arrays; `callTool` uses O(1) Map lookup instead of linear scan
- **LRU cache eviction** -- daemon ResultCache now has a max entry limit (1000) with least-recently-used eviction, preventing unbounded memory growth
- **Parallel gateway startup** -- `mcpx serve` connects to all registered servers concurrently via `Promise.allSettled` instead of sequentially

### Code Quality

- **Type-safe tool annotations** -- new `ToolAnnotations` and `AnnotatedTool` types in `src/mcp/types.ts` replace all `(tool as any).annotations` casts across 5 files
- Excluded `__tests__` from TypeScript build output via `tsconfig.json`

### Documentation

- Added Authentication section to README with examples for Bearer tokens, custom headers, OAuth, and SSE transport
- Added comprehensive MCP vs mcpx evaluation guide (`docs/mcp-vs-mcpx-eval.md`) with latency benchmarks, token-budget estimates, and reproducible manual eval
- Improved eval doc portability: replaced hardcoded paths with `$REPO` / `<REPO>` placeholders, added quick-start one-liner, condensed sandbox caveats, flagged token estimates as order-of-magnitude
- Updated README with batch `--parallel`, exit code 124, daemon health checks, and pipe-friendly `--field`

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
