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
| `mcpx add <alias> <cmd>` | Register an MCP server |
| `mcpx remove <alias>` | Remove a registered server |
| `mcpx servers` | List registered servers |
| `mcpx list [/server]` | List available tools |
| `mcpx schema /server <tool>` | Show tool input schema |
| `mcpx /server <tool> --params '{}'` | Execute a tool |
| `mcpx interactive [/server]` | Start interactive REPL |
| `mcpx import [path]` | Import from Claude Desktop config |
| `mcpx skills /server` | Generate agent skill docs |
| `mcpx daemon start\|stop\|status` | Manage connection daemon |

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
```

## Output Formats

By default, all commands return a JSON envelope (agent-friendly). Use `--format` for human-readable output:

```bash
mcpx list /weather --format table    # tabular output
mcpx list /weather --format yaml     # YAML output
mcpx list /weather --format json     # JSON envelope (default)
```

## Output Contract

Agent-facing commands return a JSON envelope:

```json
{"ok": true, "result": [{"type": "text", "text": "..."}]}
{"ok": false, "error": {"code": 3, "message": "Missing required: city"}}
```

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

## Connection Daemon

mcpx spawns a background daemon to cache MCP server connections:

```bash
mcpx daemon start    # Start daemon (auto-starts on first use)
mcpx daemon status   # Check if running
mcpx daemon stop     # Stop daemon
```

The daemon auto-exits after 5 minutes of inactivity.

## Agent Skills

Generate SKILL.md documentation for any registered server:

```bash
mcpx skills /pg > SKILL-pg.md
```

## Development

```bash
npm run build        # Compile TypeScript
npm run dev          # Run via tsx
npm test             # Run all tests
```

## License

MIT
