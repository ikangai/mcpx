# MCP vs mcpx: Reproducible Evaluation

## Servers Tested

| # | Server | Package | Tools | Transport |
|---|--------|---------|-------|-----------|
| 1 | everything | `@modelcontextprotocol/server-everything` | 13 | stdio |
| 2 | postgres | `@toolbox-sdk/server --prebuilt=postgres --stdio` | 29 | stdio |
| 3 | filesystem | `@modelcontextprotocol/server-filesystem` | 14 | stdio |
| 4 | memory | `@modelcontextprotocol/server-memory` | 9 | stdio |
| 5 | datetime | `mcp-datetime` | 10 | stdio |
| 6 | math | `mcp-mathtools` | 12 | stdio |
| 7 | text | `mcp-texttools` | 15 | stdio |
| 8 | git | `mcp-git` | 15 | stdio |
| 9 | kubernetes | `mcp-server-kubernetes` | 23 | stdio |
| 10 | google-workspace | `workspace-mcp` (Python, uvx) | 121 | stdio |
| 11 | sqlite | `mcp-server-sqlite` (Python, uvx) | 6 | stdio |
| 12 | sequential-thinking | `@modelcontextprotocol/server-sequential-thinking` | 1 | stdio |
| 13 | bazi | `bazi-mcp` | 3 | stdio |

Total: **271 tools across 13 servers**

## Setup

### Prerequisites

```bash
# Node.js 18+
node --version

# For postgres tests
docker run -d --name mcpx-pg -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:17
# Wait for ready:
docker exec mcpx-pg pg_isready

# For Python servers
pip install uv  # or: brew install uv

# Install mcpx
cd /path/to/mcpx && npm install && npm run build
```

### Register servers for mcpx

```bash
export MCPX_CONFIG_DIR=~/.config/mcpx

# everything (reference server — echo, get-sum, get-tiny-image, etc.)
mcpx add everything "npx -y @modelcontextprotocol/server-everything"

# postgres (requires Docker)
mcpx add pg "npx -y @toolbox-sdk/server --prebuilt=postgres --stdio" \
  -e POSTGRES_HOST=localhost -e POSTGRES_PORT=5432 \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DATABASE=postgres

# filesystem
mcpx add fs "npx -y @modelcontextprotocol/server-filesystem /tmp"

# memory (knowledge graph)
mcpx add memory "npx -y @modelcontextprotocol/server-memory"

# datetime
mcpx add datetime "npx -y mcp-datetime"

# math
mcpx add math "npx -y mcp-mathtools"

# text
mcpx add text "npx -y mcp-texttools"

# git
mcpx add git "npx -y mcp-git"

# kubernetes (tool discovery only — no cluster needed)
mcpx add k8s "npx -y mcp-server-kubernetes"

# sqlite (Python)
mcpx add sqlite "uvx mcp-server-sqlite --db-path /tmp/mcpx-eval.db"

# sequential-thinking
mcpx add thinking "npx -y @modelcontextprotocol/server-sequential-thinking"

# bazi (Chinese/Unicode)
mcpx add bazi "npx -y bazi-mcp"
```

### Register servers for native MCP (Claude Code)

```bash
# everything
claude mcp add --transport stdio everything -- npx -y @modelcontextprotocol/server-everything

# postgres
claude mcp add --transport stdio \
  --env POSTGRES_HOST=localhost --env POSTGRES_PORT=5432 \
  --env POSTGRES_USER=postgres --env POSTGRES_PASSWORD=postgres \
  --env POSTGRES_DATABASE=postgres \
  pg -- npx -y @toolbox-sdk/server --prebuilt=postgres --stdio

# filesystem
claude mcp add --transport stdio fs -- npx -y @modelcontextprotocol/server-filesystem /tmp

# memory
claude mcp add --transport stdio memory -- npx -y @modelcontextprotocol/server-memory

# datetime
claude mcp add --transport stdio datetime -- npx -y mcp-datetime

# math
claude mcp add --transport stdio math -- npx -y mcp-mathtools

# text
claude mcp add --transport stdio text -- npx -y mcp-texttools

# git
claude mcp add --transport stdio git -- npx -y mcp-git

# kubernetes
claude mcp add --transport stdio k8s -- npx -y mcp-server-kubernetes

# sqlite
claude mcp add --transport stdio sqlite -- uvx mcp-server-sqlite --db-path /tmp/mcpx-eval.db

# thinking
claude mcp add --transport stdio thinking -- npx -y @modelcontextprotocol/server-sequential-thinking

# bazi
claude mcp add --transport stdio bazi -- npx -y bazi-mcp
```

---

## Test Cases

Each test shows the exact command for both approaches. Run manually to compare.

### Test 1: Simple Echo

**mcpx CLI:**
```bash
# Envelope (default)
mcpx /everything echo --params '{"message":"hello"}'

# Raw (token-optimized)
mcpx -r /everything echo --params '{"message":"hello"}'
```

**Native MCP (what Claude Code generates internally):**
```
tool_use: echo
input: {"message": "hello"}
```

**What to measure:**
- mcpx envelope output size: `mcpx /everything echo --params '{"message":"hello"}' | wc -c`
- mcpx raw output size: `mcpx -r /everything echo --params '{"message":"hello"}' | wc -c`
- Execution time: `time mcpx -r /everything echo --params '{"message":"hello"}'`

**Expected results:**

| Metric | mcpx envelope | mcpx raw | MCP native |
|--------|--------------|----------|------------|
| Output tokens (LLM generates) | ~16 | ~17 | ~8 |
| Input tokens (result fed back) | ~24 | ~3 | ~3 |
| Total tokens | ~40 | ~20 | ~11 |
| Execution time | ~110ms | ~110ms | ~5ms |

---

### Test 2: Postgres Database Overview

**mcpx CLI:**
```bash
mcpx -r /pg database_overview
```

**Native MCP:**
```
tool_use: database_overview
input: {}
```

**Expected results:**

| Metric | mcpx raw | MCP native |
|--------|----------|------------|
| Output tokens | ~11 | ~5 |
| Input tokens | ~47 | ~47 |
| Total tokens | ~58 | ~52 |
| Gap | +12% | baseline |

---

### Test 3: Postgres SQL Query

**mcpx CLI:**
```bash
mcpx -r /pg execute_sql --params '{"sql":"SELECT count(*) as n FROM users"}'
```

**Native MCP:**
```
tool_use: execute_sql
input: {"sql": "SELECT count(*) as n FROM users"}
```

**Expected results:**

| Metric | mcpx raw | MCP native |
|--------|----------|------------|
| Output tokens | ~23 | ~15 |
| Input tokens | ~2 | ~2 |
| Total tokens | ~25 | ~17 |

---

### Test 4: Datetime Timezone Conversion

**mcpx CLI:**
```bash
mcpx -r /datetime convert_timezone --params '{"datetime":"2026-04-08T12:00:00","from_tz":"UTC","to_tz":"Europe/Berlin"}'
```

**Native MCP:**
```
tool_use: convert_timezone
input: {"datetime": "2026-04-08T12:00:00", "from_tz": "UTC", "to_tz": "Europe/Berlin"}
```

---

### Test 5: Math Statistics (Array Param)

**mcpx CLI:**
```bash
mcpx -r /math statistics --params '{"numbers":[1,2,3,4,5,6,7,8,9,10]}'
```

**Native MCP:**
```
tool_use: statistics
input: {"numbers": [1,2,3,4,5,6,7,8,9,10]}
```

---

### Test 6: Text Case Convert (Enum Param)

**mcpx CLI:**
```bash
mcpx -r /text case_convert --params '{"text":"hello world from mcpx","to":"snake"}'
```

**Native MCP:**
```
tool_use: case_convert
input: {"text": "hello world from mcpx", "to": "snake"}
```

---

### Test 7: Per-Field Flags (CLI only)

**mcpx CLI (per-field flags — human-friendly sugar):**
```bash
mcpx -r /text case_convert --text "hello world from mcpx" --to pascal
```

MCP has no equivalent — params are always JSON.

---

### Test 8: Tool Discovery

**mcpx CLI:**
```bash
# List all tools on a server
mcpx -r /pg

# Get schema for a specific tool
mcpx -r /pg execute_sql --help

# Full JSON schema
mcpx schema /pg execute_sql
```

**Native MCP:**
```
# Tool search (automatic, deferred)
# Claude Code loads tool names at session start (~120 tokens)
# Full schema loaded on demand via ToolSearch tool

# Manual: /mcp in Claude Code to see servers
```

**Token cost comparison:**

| Discovery action | mcpx CLI | MCP (tool search) | MCP (no tool search) |
|-----------------|----------|-------------------|---------------------|
| Init cost | 0 tokens | ~120 tokens (names) | 6,500-77,000 tokens |
| List one server | 1 Bash call | 0 (already loaded) | 0 (already loaded) |
| Get one schema | 1 Bash call (~190 tokens) | 1 ToolSearch call (~200 tokens) | 0 (already loaded) |

---

### Test 9: Composition — Pipe + jq (CLI only)

**mcpx CLI:**
```bash
# Extract one field via jq (one Bash call, 1 API roundtrip)
mcpx -r /pg database_overview | jq -r .pg_version

# Chain two tools (one Bash call, 1 API roundtrip)
mcpx -r /pg database_overview && mcpx -r /pg list_schemas

# Conditional (one Bash call, 1 API roundtrip)
pct=$(mcpx -r /pg database_overview | jq -r .pct_connections_used)
echo "$pct > 80" | bc | grep -q 1 && echo "HIGH" || echo "OK"
```

**Native MCP:**
```
# Cannot pipe. Agent must:
#   Call 1: database_overview → LLM reads result → 1 API roundtrip
#   Call 2: LLM decides what to do next → 1 API roundtrip
# Minimum 2 API roundtrips for any composition
```

**Cost comparison for "get version + count users + format summary":**

| Metric | mcpx CLI (one Bash call) | MCP native |
|--------|------------------------|------------|
| API roundtrips | 1 | 2-3 |
| Wall-clock time | 1-3s (one LLM inference) | 3-9s (2-3 LLM inferences) |
| Tool tokens | ~90 | ~76 |
| Total tokens (incl. LLM) | ~90 + 1 inference | ~152 + 2-3 inferences |

---

### Test 10: Batch Mode (CLI only)

**mcpx CLI:**
```bash
# 3 tools in one process invocation
echo '{"tool":"echo","params":{"message":"hello"}}
{"tool":"get-sum","params":{"a":10,"b":20}}
{"tool":"echo","params":{"message":"world"}}' | mcpx batch /everything
```

**Native MCP:**
```
# No batch. 3 separate tool_use calls = 3 API roundtrips.
# Claude Code does support parallel tool calls in one response,
# but each still requires the full schema in context.
```

**Timing:**

| Method | 3 calls | 10 calls |
|--------|---------|----------|
| mcpx batch (1 process) | 120ms | 120ms |
| mcpx separate calls | 350ms | 1,100ms |
| MCP native | 15ms | 50ms |
| Actual wall-clock (incl. LLM roundtrips) | 1-3s (1 RT) | 1-3s (1 RT) vs 10-30s (10 RTs) |

---

### Test 11: Conditional & Error Handling (CLI only)

**mcpx CLI:**
```bash
# Try/catch with fallback
mcpx -r /pg execute_sql --params '{"sql":"SELECT 1"}' 2>/dev/null || echo "failed"

# Exit code checking
mcpx -r /pg nonexistent_tool 2>/dev/null
echo "Exit: $?"  # → 3 (validation error)

# Loop until condition
while true; do
  active=$(mcpx -r /pg list_active_queries | jq -r '.[0].query_duration // "0"')
  [ "$active" = "0" ] && break
  sleep 5
done
```

**Native MCP:**
```
# Every condition check = 1 API roundtrip (LLM must process result)
# A loop of 5 checks = 5 API roundtrips = 5-15 seconds of LLM time
```

---

### Test 12: Cross-Server Workflow

**mcpx CLI (workflow file):**
```bash
cat > /tmp/eval-workflow.yaml << 'EOF'
name: DB Status Report
steps:
  - server: pg
    tool: database_overview
    output: db
  - server: pg
    tool: execute_sql
    params:
      sql: "SELECT count(*) as n FROM users"
    output: counts
  - server: everything
    tool: echo
    params:
      message: "DB {{db.pg_version}} has {{counts.n}} users"
    output: summary
EOF
mcpx workflow /tmp/eval-workflow.yaml
```

**Native MCP:**
```
# Agent must chain manually:
# Call 1: pg.database_overview → result
# Call 2: pg.execute_sql({sql: "SELECT count(*) ..."}) → result
# Call 3: everything.echo({message: "DB ... has ... users"}) → result
# = 3 API roundtrips, agent composes logic in prompt
```

---

### Test 13: Tool Annotations (Kubernetes)

**mcpx CLI:**
```bash
# List tools with annotations
mcpx list /k8s | jq '.tools[] | select(.annotations) | {name, annotations}'

# Help shows hints
mcpx -r /k8s kubectl_delete --help
# → "Hints: destructive"
```

**Native MCP:**
```
# Annotations are in tool schemas — visible to LLM in context.
# No CLI equivalent of "showing" them to the user.
```

---

### Test 14: MCP-Only Features

These work with native MCP but NOT with mcpx CLI:

```bash
# Resources (@ mentions in Claude Code)
# @pg:schema://users — reference a resource inline

# Prompts (/ commands in Claude Code)
# /mcp__pg__debug_query — execute a prompt

# Channels (push notifications)
# MCP server pushes events into session

# Tool search (deferred schemas)
# ~120 tokens for all tool names, schemas loaded on demand

# OAuth discovery
# /mcp → authenticate → automatic token refresh

# Dynamic tool updates (list_changed notifications)
# Server adds a tool → Claude Code picks it up immediately
```

**mcpx partial equivalents:**
```bash
# Resources
mcpx resources /everything
mcpx resource /everything "demo://resource/static/document/architecture.md"

# Prompts
mcpx prompts /everything
mcpx prompt /everything simple-prompt

# But: no @ mentions, no / commands, no push, no OAuth, no dynamic updates
```

---

## Comprehensive Comparison Table

| Dimension | mcpx CLI | mcpx --raw | mcpx batch | mcpx serve (MCP) | Native MCP |
|-----------|---------|-----------|-----------|-----------------|------------|
| **Token cost** | | | | | |
| Simple tool call | 40 tok | 20 tok | 20/call | ~11 tok | ~11 tok |
| Complex call (postgres) | 83 tok | 58 tok | 58/call | ~55 tok | ~55 tok |
| Init context cost | 0 | 0 | 0 | ~2,600 | 120-77,000 |
| **Execution time** | | | | | |
| Single call (daemon warm) | 110ms | 110ms | — | ~5ms | ~5ms |
| Single call (cold) | 770ms | 770ms | — | ~500ms | ~500ms |
| 3 calls | 350ms | 350ms | 120ms | ~15ms | ~15ms |
| 10 calls | 1,100ms | 1,100ms | 120ms | ~50ms | ~50ms |
| **Composition** | | | | | |
| Pipe to jq | ✓ | ✓ | ✓ | ✗ | ✗ |
| Chain with && | ✓ | ✓ | — | ✗ | ✗ |
| Shell variables | ✓ | ✓ | — | ✗ | ✗ |
| Shell conditionals | ✓ | ✓ | — | ✗ | ✗ |
| Shell loops | ✓ | ✓ | — | ✗ | ✗ |
| Pipe between tools | ✓ (stdin) | ✓ | — | ✗ | ✗ |
| **API roundtrips** | | | | | |
| 1 tool | 1 | 1 | 1 | 1 | 1 |
| 3 tools (composed) | 1 | 1 | 1 | 3 | 3 |
| Conditional + retry | 1 | 1 | — | 2+ | 2+ |
| Loop of N checks | 1 | 1 | — | N | N |
| **Features** | | | | | |
| Tool invocation | ✓ | ✓ | ✓ | ✓ | ✓ |
| Tool discovery | ✓ | ✓ | — | ✓ | ✓ |
| Schema introspection | ✓ | ✓ | — | ✓ | ✓ |
| Prompts | ✓ | ✓ | — | ✗ | ✓ |
| Resources | ✓ | ✓ | — | ✗ | ✓ |
| @ mentions | ✗ | ✗ | ✗ | ✗ | ✓ |
| / commands | ✗ | ✗ | ✗ | ✗ | ✓ |
| Push notifications | ✗ | ✗ | ✗ | ✗ | ✓ |
| OAuth discovery | ✗ | ✗ | ✗ | ✗ | ✓ |
| Dynamic tool updates | ✗ | ✗ | ✗ | ✗ | ✓ |
| Tool annotations | ✓ | ✓ | — | ✓ | ✓ |
| Audit logging | ✓ | ✓ | ✓ | ✗ | ✗ |
| Schema diff | ✓ | ✓ | — | ✗ | ✗ |
| Health check | ✓ | ✓ | — | ✗ | ✗ |
| Workflows (YAML) | ✓ | ✓ | — | ✗ | ✗ |
| Hooks (before/after) | ✓ | ✓ | ✓ | ✗ | ✗ |
| **Security** | | | | | |
| Haiku security scan | Yes (per Bash call) | Yes | Yes (1x) | No | No |
| Permission prompt | Yes (unless bypass) | Yes | Yes (1x) | Pre-approved | Pre-approved |
| Auth mechanism | Pre-configured env | Same | Same | Bearer token | OAuth 2.0 |
| **Best for** | Developers, CI/CD | Agent workflows | Multi-call batches | MCP clients | Claude Code/Desktop |

---

## Running the Full Eval

```bash
cd /path/to/mcpx
export MCPX_CONFIG_DIR=~/.config/mcpx

# 1. Register all servers (run setup commands above)

# 2. Verify all servers work
for s in everything pg fs memory datetime math text git k8s sqlite thinking bazi; do
  echo -n "$s: "
  mcpx test /$s 2>&1 | jq -r '.result[0].text' | grep -o 'All checks passed.*' || echo "FAILED"
done

# 3. Run token cost measurements
echo "=== Token costs ==="
for test in \
  "/everything echo --params '{\"message\":\"hello\"}'" \
  "/pg database_overview" \
  "/pg execute_sql --params '{\"sql\":\"SELECT count(*) as n FROM users\"}'" \
  "/datetime convert_timezone --params '{\"datetime\":\"2026-04-08T12:00:00\",\"from_tz\":\"UTC\",\"to_tz\":\"Europe/Berlin\"}'" \
  "/math statistics --params '{\"numbers\":[1,2,3,4,5,6,7,8,9,10]}'" \
  "/text case_convert --params '{\"text\":\"hello world\",\"to\":\"snake\"}'"; do
  
  env_size=$(eval "mcpx $test" 2>&1 | wc -c | tr -d ' ')
  raw_size=$(eval "mcpx -r $test" 2>&1 | wc -c | tr -d ' ')
  cmd_size=$(echo -n "mcpx -r $test" | wc -c | tr -d ' ')
  echo "$test"
  echo "  envelope: ${env_size}B  raw: ${raw_size}B  cmd: ${cmd_size}B  total: $((cmd_size/4 + raw_size/4)) tokens"
done

# 4. Run timing measurements
echo "=== Timing ==="
mcpx -r /everything echo --params '{"message":"warmup"}' > /dev/null 2>&1
for i in 1 2 3; do
  echo -n "  daemon warm #$i: "
  /usr/bin/time -p mcpx -r /everything echo --params '{"message":"t"}' 2>&1 | grep real
done

mcpx daemon stop > /dev/null 2>&1
echo -n "  cold start: "
/usr/bin/time -p mcpx -r /everything echo --params '{"message":"cold"}' 2>&1 | grep real

echo -n "  batch (3 calls): "
/usr/bin/time -p sh -c 'echo '\''{"tool":"echo","params":{"message":"1"}}
{"tool":"echo","params":{"message":"2"}}
{"tool":"echo","params":{"message":"3"}}'\'' | mcpx batch /everything > /dev/null' 2>&1 | grep real

# 5. Run composition tests
echo "=== Composition ==="
echo "  pipe to jq:"
mcpx -r /pg database_overview | jq -r .pg_version

echo "  chain 2 tools:"
mcpx -r /pg database_overview > /dev/null && mcpx -r /pg list_schemas > /dev/null && echo "  OK"

echo "  conditional:"
pct=$(mcpx -r /pg database_overview | jq -r .pct_connections_used)
echo "  Connection usage: ${pct}%"

# 6. Cross-server workflow
cat > /tmp/eval-workflow.yaml << 'EOF'
name: Eval Workflow
steps:
  - server: pg
    tool: database_overview
    output: db
  - server: datetime
    tool: now
    output: time
  - server: everything
    tool: echo
    params:
      message: "PG {{db.pg_version}} at {{time.UTC.human}}"
    output: summary
EOF
echo "=== Cross-server workflow ==="
mcpx workflow /tmp/eval-workflow.yaml | jq -r '.result[0].text'
```

---

## Key Findings

1. **Single-call tokens**: MCP native wins by ~9 tokens per call (~15% for simple, ~8% for complex)
2. **Init cost**: CLI wins (0 tokens vs 120-77,000 for MCP)
3. **Composition**: CLI wins decisively — shell composition reduces API roundtrips
4. **Multi-call workflows**: CLI batch + composition = 1 roundtrip vs N for MCP
5. **Enterprise features**: MCP wins (OAuth, push, @mentions, /commands)
6. **The real bottleneck**: LLM inference (1-3s per roundtrip), not tool execution (5-110ms)
