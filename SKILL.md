---
name: mcpx-cli
description: Use when interacting with external services via MCP servers, composing multi-tool workflows, scripting tool calls with conditionals/loops, or when the user mentions mcpx. Prefer scripting mcpx over individual MCP tool calls when chaining, filtering, or automating across servers.
---

# mcpx — Scriptable MCP CLI

## Overview

`mcpx` exposes any MCP server as CLI commands. Use it via Bash to compose tool calls into scripts — conditionals, loops, pipes, parallel execution — instead of one-at-a-time MCP tool calls.

## When to Use

- User wants to call MCP tools from the command line
- You need to chain results across multiple MCP servers
- Conditional logic based on tool output (if/then/else)
- Batch operations (loop over inputs, aggregate results)
- When `--raw` or `-f raw` output enables piping to `jq`, `grep`, etc.
- User explicitly mentions `mcpx`

**Don't use when:** A single MCP tool call suffices and no scripting is needed — use native MCP tools directly.

## Quick Reference

| Task | Command |
|------|---------|
| List registered servers | `mcpx servers` |
| List tools on a server | `mcpx list /server` |
| Call a tool | `mcpx /server tool --flag value` |
| Call with JSON params | `mcpx /server tool --json '{"key": "value"}'` |
| Raw output (no envelope) | `mcpx -r /server tool --flag value` |
| Full schema for a tool | `mcpx schema /server tool` |
| Test server connectivity | `mcpx test /server` |
| Add a server | `mcpx add alias "npx @scope/server-pkg"` |
| Remove a server | `mcpx remove alias` |
| Batch calls from stdin | `echo '{"tool":"name","params":{}}' \| mcpx batch /server` |
| Watch (poll) | `mcpx watch 5s /server tool --flag value` |

## Output Modes

- **Default (JSON envelope):** `{ "ok": true, "result": [...] }` — structured, parseable
- **`-r` / `--raw`:** Raw content only, no envelope — best for piping and scripting
- **`-f table`:** Human-friendly table
- **`-f yaml`:** YAML output

**For scripting, always use `-r` or default JSON + `jq`.**

## Scripting Patterns

### Chain tools across servers
```bash
# Get data from one server, use it in another
city=$(mcpx -r /geocode lookup --address "Berlin" | jq -r '.latitude, .longitude')
mcpx /weather get-forecast --latitude ${city[0]} --longitude ${city[1]}
```

### Loop over inputs
```bash
for state in CA NY TX FL; do
  mcpx -r /weather get-alerts --state "$state"
done | jq -s '.'
```

### Conditional actions
```bash
result=$(mcpx -r /monitor check-status --service api)
if echo "$result" | grep -q "unhealthy"; then
  mcpx /slack send --channel ops --text "API is down"
fi
```

### Parallel execution
```bash
mcpx -r /db query --sql "SELECT count(*) FROM users" &
mcpx -r /db query --sql "SELECT count(*) FROM orders" &
wait
```

### Batch calls (NDJSON stdin)
```bash
cat <<'EOF' | mcpx batch /server
{"tool":"get-user","params":{"id":1}}
{"tool":"get-user","params":{"id":2}}
{"tool":"get-user","params":{"id":3}}
EOF
```

### YAML workflows
```bash
mcpx workflow pipeline.yaml
```
Workflows support `{{variable}}` interpolation between sequential steps.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| `--format` after slash command | Global flags go BEFORE: `mcpx -f table /server tool` |
| Package doesn't exist | Verify with `npm search` before `mcpx add` |
| "Connection closed" error | Server binary failed to start — check command with `mcpx test /server` |
| Complex nested params as flags | Use `--json '{"nested": {"key": "val"}}'` instead |
