# mcpx

**One CLI for any MCP server -- built for humans and AI agents.**

> Transform MCP servers into ergonomic CLI commands. Register once, invoke anywhere.

## Quick Start

```bash
# Install
npm install -g mcpx

# Register a server
mcpx add weather "npx @mcp/server-weather"

# Discover tools
mcpx list /weather
mcpx schema /weather get-forecast

# Invoke (agent-optimized)
mcpx /weather get-forecast --params '{"city": "Berlin"}'

# Invoke (human-friendly)
mcpx /weather get-forecast --city Berlin
```

## Why mcpx?

**For humans** -- stop wiring MCP servers by hand. `mcpx` gives you `--help` on every tool, `--dry-run` to preview, and interactive mode for exploration.

**For AI agents** -- every response is structured JSON with semantic exit codes. Your agent gets a deterministic CLI interface with zero custom tooling.

## Commands

| Command | Description |
|---------|-------------|
| `mcpx add <alias> <cmd-or-url>` | Register an MCP server (stdio or HTTP) |
| `mcpx remove <alias>` | Remove a registered server |
| `mcpx servers` | List registered servers |
| `mcpx list [/server]` | List available tools |
| `mcpx schema /server <tool>` | Show tool input schema |
| `mcpx /server <tool> --params '{}'` | Execute a tool |
| `mcpx interactive [/server]` | Start interactive REPL |
| `mcpx import [path]` | Import from Claude Desktop config |
| `mcpx skills /server` | Generate agent skill docs |
| `mcpx daemon start\|stop\|status` | Manage connection daemon |
| `mcpx inspect /server` | Show server capabilities and metadata |
| `mcpx prompts /server` | List MCP prompt templates |
| `mcpx prompt /server <name>` | Get a prompt template |
| `mcpx resources /server` | List MCP resources |
| `mcpx resource /server <uri>` | Read a resource |
| `mcpx diff /server` | Compare tool schemas against snapshot |
| `mcpx test /server` | Verify server health |
| `mcpx watch <interval> /server <tool>` | Periodic re-execution |
| `mcpx workflow <file>` | Run multi-step YAML workflow |
| `mcpx hook add\|list\|remove` | Manage middleware hooks |
| `mcpx alias set\|list\|remove` | Manage tool aliases |
| `mcpx run <name>` | Execute a saved alias |

## Invocation Patterns

```bash
# Slash-command (primary)
mcpx /server tool --params '{"key": "value"}'

# Per-field flags (human sugar)
mcpx /server tool --key value

# Single-shot from another tool
mcpx -p '/server tool --params \'{"key": "value"}\''

# Legacy exec mode
mcpx -s "npx @mcp/server" exec tool --key value

# Pipe output between tools
mcpx /pg execute_sql --params '{"sql":"SELECT id FROM users"}' | mcpx /pg get_column_cardinality --params-stdin

# Extract a specific field
mcpx /pg database_overview --field uptime
```

## Output Formats

By default, all commands return a JSON envelope (agent-friendly). Use `--format` for human-readable output:

```bash
mcpx list /weather --format table    # tabular output
mcpx list /weather --format yaml     # YAML output
mcpx list /weather --format json     # JSON envelope (default)
mcpx list /weather --format csv      # CSV output
mcpx list /weather --format markdown # Markdown table
```

## Output Contract

Agent-facing commands return a JSON envelope:

```json
{"ok": true, "result": [{"type": "text", "text": "..."}]}
{"ok": true, "tools": [{"name": "...", "description": "...", "inputSchema": {...}}]}
{"ok": true}
{"ok": false, "error": {"code": 3, "message": "Missing required: city"}}
```

Success envelopes contain one of: `result` (tool output), `tools` (listing), `schema` (introspection), `servers` (registry), or no payload (add/remove/update confirmation).

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Tool execution error |
| 2 | Connection error |
| 3 | Validation error |
| 4 | Config error |
| 5 | Internal error |

## Server Registration

```bash
# Register with env vars
mcpx add pg "npx @toolbox-sdk/server --prebuilt=postgres --stdio" \
  -e POSTGRES_HOST=localhost \
  -e POSTGRES_PASSWORD=secret

# Import from Claude Desktop
mcpx import
```

## Authentication

mcpx supports multiple authentication methods for remote MCP servers:

### Static Bearer Token

```bash
mcpx add api "https://mcp.example.com/v1" \
  -H "Authorization: Bearer sk-your-token"
```

### Custom Headers

```bash
mcpx add api "https://mcp.example.com/v1" \
  -H "X-API-Key: your-key" \
  -H "X-Org-Id: org-123"
```

### OAuth Client Credentials

```bash
mcpx add api "https://mcp.example.com/v1" \
  --oauth-client-id your-client-id \
  --oauth-client-secret your-secret \
  --oauth-scope "read write"
```

### SSE Transport

```bash
mcpx add api "https://mcp.example.com/sse" --transport sse
```

### Stdio with Environment Variables (existing)

```bash
mcpx add pg "npx @mcp/server-postgres" \
  -e POSTGRES_PASSWORD=secret
```

## Connection Daemon

mcpx spawns a background daemon to cache MCP server connections:

```bash
mcpx daemon start    # Start daemon (auto-starts on first use)
mcpx daemon status   # Check if running
mcpx daemon stop     # Stop daemon
```

The daemon auto-exits after 5 minutes of inactivity.

## MCP Protocol Features

mcpx exposes the full MCP protocol surface — not just tools:

```bash
mcpx inspect /pg              # server name, version, capabilities, instructions
mcpx prompts /pg              # list prompt templates
mcpx prompt /pg debug-query   # get a specific prompt
mcpx resources /pg            # list data resources
mcpx resource /pg <uri>       # read a resource
```

## MCP Gateway

mcpx can act as a universal MCP aggregator, exposing all registered servers through a single connection:

```bash
mcpx serve                   # stdio (for Claude Desktop / Cursor)
mcpx serve --port 8080       # HTTP (for remote agents)
curl http://localhost:8080/health
```

## Workflows

Run multi-step operations across servers with YAML workflow files:

```yaml
# workflow.yaml
name: Daily Report
steps:
  - server: pg
    tool: execute_sql
    params: { sql: "SELECT count(*) as n FROM orders" }
    output: count
  - server: slack
    tool: send_message
    params: { text: "Orders today: {{count}}" }
```

```bash
mcpx workflow workflow.yaml
```

Steps execute sequentially. Use `output` to name variables, `{{var}}` to interpolate.

## Hooks

Run shell commands before or after tool calls:

```bash
mcpx hook add 'before:pg.*' 'echo "$MCPX_TOOL" >> /var/log/mcpx.log'
mcpx hook add 'after:pg.execute_sql' 'notify-send "SQL executed"'
mcpx hook list
mcpx hook remove 'before:pg.*'
```

Hooks receive `MCPX_SERVER`, `MCPX_TOOL`, and `MCPX_PARAMS` environment variables.

## Monitoring & Observability

```bash
mcpx watch 5s /pg list_active_queries       # poll every 5 seconds (NDJSON output)
mcpx test /pg                               # health check with latency
mcpx diff /pg                               # detect schema changes
mcpx --log /var/log/mcpx.ndjson /pg tool    # audit trail
```

## Agent Skills

Generate SKILL.md documentation for any registered server:

```bash
mcpx skills /pg > SKILL-pg.md
```

## Evaluation

A detailed comparison of direct MCP usage vs `mcpx` is available in [`docs/mcp-vs-mcpx-eval.md`](docs/mcp-vs-mcpx-eval.md). It covers:

- Automated test coverage (430 tests across 49 test files)
- Latency benchmarks (direct MCP vs `mcpx` inline vs daemon-cached)
- Token-budget estimates for agent consumption
- A reproducible manual eval you can run end-to-end
- Gap analysis and next steps

## Development

```bash
npm run build        # Compile TypeScript
npm run dev          # Run via tsx
npm test             # Run all tests
npm run bench        # Benchmark direct MCP vs mcpx
```

## License

MIT
