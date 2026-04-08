# MCP vs mcpx Eval

This document compares direct MCP consumption with `mcpx`, lists the servers that are actually exercised by this repo, and gives a manual eval you can run end-to-end.

**Quick start:** To run the automated suite, use `npm test`. The manual eval below exercises the same fixture server with explicit shell commands.

Important framing:

- `mcpx` is not an alternative to MCP. It is a CLI bridge on top of MCP.
- The automated suite in this repo exercises `mcpx` against a local MCP fixture server.
- This repo does not contain an automated Claude Desktop or Claude Code harness. Any Claude-side steps below are manual equivalents, not repo-executed tests.

## What This Repo Actually Tests

The current eval suite covers 84 scenario checks across these files:

| File | Focus | Checks |
| --- | --- | ---: |
| `test/evals/discovery.test.ts` | registration and tool discovery | 8 |
| `test/evals/schema.test.ts` | schema introspection | 8 |
| `test/evals/invocation.test.ts` | tool execution and validation | 15 |
| `test/evals/output.test.ts` | JSON envelope and exit codes | 12 |
| `test/evals/e2e.test.ts` | full agent workflow | 7 |
| `test/evals/features.test.ts` | server CRUD, import, skills, completion, daemon | 20 |
| `test/evals/advanced.test.ts` | inspect, test, params-stdin, formats, alias, hook, diff, workflow, prompts, resources | 14 |

The only MCP server that is actually used for tool execution in the automated suite is:

| Server | Path | Actually invoked? | Notes |
| --- | --- | --- | --- |
| `test-server` | `test/integration/test-server.ts` | yes | the real fixture server used by integration tests and evals |

The fixture server exposes these seven tools:

| Tool | Purpose |
| --- | --- |
| `greet` | string + optional boolean input |
| `add` | numeric input |
| `fail` | deterministic tool error |
| `echo` | roundtrip fidelity |
| `search` | string + optional number + optional string array |
| `validate` | string format validation |
| `multi-content` | multi-item content response |

Other server entries seen in tests are config-only cases, not distinct MCP implementations:

| Server entry | Where used | Actually invoked? | Notes |
| --- | --- | --- | --- |
| `imported` with `echo hello` | `test/evals/features.test.ts` | no | used only to test `mcpx import` |
| forced `test` overwrite with `echo forced` | `test/evals/features.test.ts` | no | used only to test `mcpx import --force`, then restored |
| README examples like `@mcp/server-weather` | docs only | no | example servers, not part of automated eval |

## Detailed Comparison

This is the practical comparison that matters for evaluation:

| Dimension | Direct MCP / Claude-side use | `mcpx` |
| --- | --- | --- |
| Server registration | Configure each server in a client config such as Claude Desktop `mcpServers` | `mcpx add <alias> "<command>"` or `mcpx import` |
| Invocation primitive | MCP client performs `tools/list`, `tools/call`, `prompts/list`, `resources/list` | CLI subcommands and slash routes map to those protocol calls |
| Tool discovery | Usually hidden behind client UI or tool picker | `mcpx list [/server]` |
| Schema introspection | Usually inferred from tool metadata inside the client | `mcpx schema /server <tool>` returns focused JSON schema |
| Tool execution | Client calls `tools/call` with a JSON argument object | `mcpx /server tool --params '{...}'` or generated `--flag` arguments |
| Namespacing | Depends on client UI and how it labels server tools | stable `/server tool` namespace |
| Output format | Whatever the client renders | structured envelope by default, plus `json`, `table`, `yaml`, `csv`, `markdown` |
| Error handling | Client-specific UI feedback | deterministic exit codes: 0 success, 1 tool error, 2 connection, 3 validation, 4 config, 5 internal |
| Repeatability | Chat prompts are less exact and harder to script | shell command can be rerun verbatim |
| Agent consumption | Client may expose tools, but shell-level automation is weak | every result is parseable JSON, suitable for agents and CI |
| Multi-server workflow | handled separately in the client | one registry, one namespace, plus `workflow`, `alias`, `run` |
| Health and drift checks | usually ad hoc | `mcpx test`, `mcpx diff` |
| Observability | client-dependent | `--log`, hooks, daemon status/flush |
| Prompts and resources | supported if the client exposes them | `mcpx prompts`, `mcpx prompt`, `mcpx resources`, `mcpx resource` |
| Connection reuse | client-dependent | explicit daemon with connection pooling |
| Gateway mode | not inherent | `mcpx serve` re-exposes registered servers as one MCP server |

The core evaluation takeaway is:

- Direct MCP proves the server works at the protocol level.
- `mcpx` proves that the same MCP server can be turned into a deterministic shell interface with schema-aware flags, structured output, and scriptable workflows.

## Exact `mcpx` Command Pattern Used By The Repo

The automated test helper shells out like this:

```bash
npx tsx src/index.ts <args...>
```

The test server command used by the evals is:

```bash
npx tsx /absolute/path/to/test/integration/test-server.ts
```

Representative shell commands equivalent to the automated evals are:

```bash
# register
npx tsx src/index.ts add test "npx tsx /absolute/path/to/test/integration/test-server.ts"

# discovery
npx tsx src/index.ts list
npx tsx src/index.ts list /test

# schema
npx tsx src/index.ts schema /test add
npx tsx src/index.ts schema /test search

# invocation via JSON params
npx tsx src/index.ts /test greet --params '{"name":"World"}'
npx tsx src/index.ts /test add --params '{"a":2,"b":3}'
npx tsx src/index.ts /test search --params '{"query":"test","tags":["a","b"]}'

# invocation via generated flags
npx tsx src/index.ts /test greet --name World
npx tsx src/index.ts /test greet --name World --excited
npx tsx src/index.ts /test add --a 2 --b 3

# validation and tool error paths
npx tsx src/index.ts /test add --params '{"a":2}'
npx tsx src/index.ts /test nonexistent --params '{}'
npx tsx src/index.ts /test fail --params '{}'

# dry run and stdin
npx tsx src/index.ts /test greet --params '{"name":"World"}' --dry-run
printf '{"name":"Piped"}\n' | npx tsx src/index.ts /test greet --params-stdin

# output formatting
npx tsx src/index.ts --format csv list /test
npx tsx src/index.ts --format markdown list /test
npx tsx src/index.ts /test search --params '{"query":"test"}' --field query

# protocol-adjacent operations
npx tsx src/index.ts inspect /test
npx tsx src/index.ts test /test
npx tsx src/index.ts prompts /test
npx tsx src/index.ts resources /test

# orchestration / stateful features
npx tsx src/index.ts alias set hi "/test greet --params '{\"name\":\"Alias\"}'"
npx tsx src/index.ts run hi
npx tsx src/index.ts diff /test
npx tsx src/index.ts servers
npx tsx src/index.ts daemon status
```

## What Was Manually Verified In This Session

In this environment, `npx tsx ...` inside the Vitest eval harness failed with a sandbox-specific `listen EPERM ...tsx-...pipe` error.

To avoid that, the following equivalent pattern was manually verified:

```bash
node --import tsx ./src/index.ts <args...>
```

and the test server was launched as:

```bash
node --import tsx /absolute/path/to/test/integration/test-server.ts
```

These commands were run successfully in this session against the fixture server:

```bash
node --import tsx ./src/index.ts --config-dir /tmp/... add test "node --import tsx $REPO/test/integration/test-server.ts"
node --import tsx ./src/index.ts --config-dir /tmp/... list /test
node --import tsx ./src/index.ts --config-dir /tmp/... schema /test search
node --import tsx ./src/index.ts --config-dir /tmp/... /test greet --params '{"name":"World"}'
node --import tsx ./src/index.ts --config-dir /tmp/... inspect /test
node --import tsx ./src/index.ts --config-dir /tmp/... test /test
node --import tsx ./src/index.ts --config-dir /tmp/... /test search --params '{"query":"test"}' --field query
printf '{"name":"Piped"}\n' | node --import tsx ./src/index.ts --config-dir /tmp/... /test greet --params-stdin
node --import tsx ./src/index.ts --config-dir /tmp/... --format csv list /test
node --import tsx ./src/index.ts --config-dir /tmp/... alias set hi "/test greet --params '{\"name\":\"Alias\"}'"
node --import tsx ./src/index.ts --config-dir /tmp/... run hi
node --import tsx ./src/index.ts --config-dir /tmp/... diff /test
node --import tsx ./src/index.ts --config-dir /tmp/... prompts /test
node --import tsx ./src/index.ts --config-dir /tmp/... resources /test
```

## Claude-Side Equivalent Manual Eval

There are no shell commands in this repo that invoke tools "through Claude". Claude Desktop and Claude Code act as MCP clients, so the invocation path is:

1. configure the server in Claude
2. ask Claude to use the tool
3. Claude issues protocol calls such as `tools/list` and `tools/call`

### Claude config snippet

On macOS, the code looks for:

- `~/Library/Application Support/Claude/claude_desktop_config.json`

On Linux, it looks for:

- `~/.config/claude/claude_desktop_config.json`

Use this server entry for the same fixture (replace `<REPO>` with the absolute path to your clone):

```json
{
  "mcpServers": {
    "test": {
      "command": "node",
      "args": [
        "--import",
        "tsx",
        "<REPO>/test/integration/test-server.ts"
      ]
    }
  }
}
```

If your environment does not have the `tsx` loader available to `node`, use the exact test-harness form instead:

```json
{
  "mcpServers": {
    "test": {
      "command": "npx",
      "args": [
        "tsx",
        "<REPO>/test/integration/test-server.ts"
      ]
    }
  }
}
```

### Claude prompt equivalents

These are the direct manual requests you would give Claude after the server is configured:

| Goal | Ask Claude | Underlying MCP action | Equivalent `mcpx` command |
| --- | --- | --- | --- |
| discover tools | "List the tools available on the `test` MCP server." | `tools/list` | `mcpx list /test` |
| inspect schema | "Show me the input schema for the `search` tool on the `test` MCP server." | tool metadata from `tools/list` | `mcpx schema /test search` |
| greet | "Use the `greet` tool on the `test` MCP server with `{ \"name\": \"World\" }`." | `tools/call(name=greet, arguments={name:\"World\"})` | `mcpx /test greet --params '{"name":"World"}'` |
| excited greet | "Use `greet` with `{ \"name\": \"World\", \"excited\": true }`." | `tools/call` | `mcpx /test greet --params '{"name":"World","excited":true}'` |
| add | "Use the `add` tool with `{ \"a\": 2, \"b\": 3 }`." | `tools/call` | `mcpx /test add --params '{"a":2,"b":3}'` |
| search with array args | "Use the `search` tool with `{ \"query\": \"test\", \"tags\": [\"a\", \"b\"] }`." | `tools/call` | `mcpx /test search --params '{"query":"test","tags":["a","b"]}'` |
| trigger a tool error | "Use the `fail` tool on the `test` server." | `tools/call` returning `isError: true` | `mcpx /test fail --params '{}'` |
| inspect prompts | "List prompt templates on the `test` MCP server." | `prompts/list` | `mcpx prompts /test` |
| inspect resources | "List resources on the `test` MCP server." | `resources/list` | `mcpx resources /test` |

## Manual Eval You Can Run End-To-End

This sequence is the most practical reproducible benchmark because it exercises the same fixture server and the same capabilities as the automated suite.

### 1. Set up paths

```bash
export REPO="$(pwd)"  # run from the repo root
export TEST_SERVER="$REPO/test/integration/test-server.ts"
export CONFIG_DIR="$(mktemp -d /tmp/mcpx-manual-XXXXXX)"
cd "$REPO"
```

### 2. Register the server

Portable version:

```bash
node --import tsx ./src/index.ts --config-dir "$CONFIG_DIR" add test "node --import tsx $TEST_SERVER"
```

Exact test-harness version:

```bash
npx tsx src/index.ts --config-dir "$CONFIG_DIR" add test "npx tsx $TEST_SERVER"
```

### 3. Discovery and schema

```bash
node --import tsx ./src/index.ts --config-dir "$CONFIG_DIR" servers
node --import tsx ./src/index.ts --config-dir "$CONFIG_DIR" list /test
node --import tsx ./src/index.ts --config-dir "$CONFIG_DIR" schema /test greet
node --import tsx ./src/index.ts --config-dir "$CONFIG_DIR" schema /test search
```

Expected high-level results:

- `servers` shows alias `test`
- `list /test` returns 7 tools
- `schema /test greet` shows required `name`
- `schema /test search` shows required `query`, optional `limit`, optional `tags`

### 4. Invocation success cases

```bash
node --import tsx ./src/index.ts --config-dir "$CONFIG_DIR" /test greet --params '{"name":"World"}'
node --import tsx ./src/index.ts --config-dir "$CONFIG_DIR" /test greet --name World --excited
node --import tsx ./src/index.ts --config-dir "$CONFIG_DIR" /test add --params '{"a":2,"b":3}'
node --import tsx ./src/index.ts --config-dir "$CONFIG_DIR" /test search --params '{"query":"test","tags":["a","b"]}'
node --import tsx ./src/index.ts --config-dir "$CONFIG_DIR" /test search --params '{"query":"test"}' --field query
printf '{"name":"Piped"}\n' | node --import tsx ./src/index.ts --config-dir "$CONFIG_DIR" /test greet --params-stdin
```

Expected high-level results:

- `greet` returns `Hello, World.`
- excited `greet` returns `HELLO World!!!`
- `add` returns `5`
- `search` returns JSON text with `query`, `limit`, `tags`, `hits`
- `--field query` returns `test`
- `--params-stdin` returns `Hello, Piped.`

### 5. Error-path eval

```bash
node --import tsx ./src/index.ts --config-dir "$CONFIG_DIR" /test add --params '{"a":2}'
echo $?

node --import tsx ./src/index.ts --config-dir "$CONFIG_DIR" /test nonexistent --params '{}'
echo $?

node --import tsx ./src/index.ts --config-dir "$CONFIG_DIR" /test fail --params '{}'
echo $?
```

Expected exit-code behavior:

- missing required parameter: `3`
- unknown tool: `3`
- tool-level failure: `1`

### 6. Output-contract eval

```bash
node --import tsx ./src/index.ts --config-dir "$CONFIG_DIR" /test greet --params '{"name":"Agent"}'
node --import tsx ./src/index.ts --config-dir "$CONFIG_DIR" --format csv list /test
node --import tsx ./src/index.ts --config-dir "$CONFIG_DIR" --format markdown list /test
```

Expected high-level results:

- default output is a JSON envelope with `ok` and `result`
- CSV output has `name,description,parameters`
- Markdown output is a GFM-style table

### 7. Protocol-surface eval

```bash
node --import tsx ./src/index.ts --config-dir "$CONFIG_DIR" inspect /test
node --import tsx ./src/index.ts --config-dir "$CONFIG_DIR" test /test
node --import tsx ./src/index.ts --config-dir "$CONFIG_DIR" prompts /test
node --import tsx ./src/index.ts --config-dir "$CONFIG_DIR" resources /test
```

Expected high-level results:

- `inspect` reports `test-server` version `1.0.0`
- `test` reports connect success and tool discovery
- `prompts` returns `[]`
- `resources` returns `[]`

### 8. Stateful feature eval

```bash
node --import tsx ./src/index.ts --config-dir "$CONFIG_DIR" alias set hi "/test greet --params '{\"name\":\"Alias\"}'"
node --import tsx ./src/index.ts --config-dir "$CONFIG_DIR" run hi
node --import tsx ./src/index.ts --config-dir "$CONFIG_DIR" diff /test
node --import tsx ./src/index.ts --config-dir "$CONFIG_DIR" diff /test
node --import tsx ./src/index.ts --config-dir "$CONFIG_DIR" daemon status
```

Expected high-level results:

- alias run returns `Hello, Alias.`
- first `diff` saves a snapshot
- second `diff` reports no changes
- daemon status returns a valid envelope even if not running

## Recommended Evaluation Summary Template

If you want to record results consistently, use this matrix:

| Check | Direct MCP / Claude | `mcpx` | Pass criteria |
| --- | --- | --- | --- |
| server registration | server visible in client | alias visible in `servers` | server can be discovered |
| tool discovery | tools visible in client | `list /test` returns 7 tools | expected tool names appear |
| schema clarity | enough detail to construct args | `schema /test search` is explicit JSON | required vs optional is clear |
| invocation success | `greet`, `add`, `search` work | same | expected output values |
| validation failure | client surfaces an actionable error | exit code `3` with JSON error | error is machine-usable |
| tool failure | client surfaces tool failure | exit code `1` with JSON error | distinction from validation is clear |
| output parseability | UI-oriented | strict JSON envelope | parseable in shell/CI |
| prompts/resources | available if supported | explicit CLI coverage | empty arrays handled cleanly |
| repeatability | prompt-dependent | rerunnable command string | exact command can be versioned |

## Bottom Line

If you want a true apples-to-apples result:

- use the same fixture server on both sides
- compare direct MCP use in Claude against the equivalent `mcpx` command
- score discovery, schema visibility, invocation ergonomics, output parseability, and repeatability separately

For this repo specifically, the hard evidence is:

- one real fixture server is tested thoroughly
- the suite is centered on `tools/list`, schema extraction, `tools/call`, and envelope/error behavior
- Claude-side use is a valid manual comparison, but it is not automated in this repository today

## Benchmark Results (Run 2026-04-08)

Environment:

- repo: `mcp_2_cli`
- fixture server: `test/integration/test-server.ts`
- host timezone: Europe/Vienna

### Latency results

| Path | What was measured | n | mean (ms) | p50 (ms) | p95 (ms) | min-max (ms) |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Direct MCP (long-lived client) | connect + list + call + close (cold) | 15 | 176.29 | 175.08 | 183.94 | 168.69-188.35 |
| Direct MCP (long-lived client) | `callTool` only (warm) | 60 | 0.15 | 0.12 | 0.22 | 0.10-0.84 |
| Direct MCP (CLI-spawned script) | one process per call | 12 | 346.25 | 345.79 | 357.79 | 332.79-362.89 |
| `mcpx` inline (`-s ... exec`) | one process per call | 12 | 371.34 | 367.40 | 387.59 | 352.97-393.19 |
| `mcpx` alias (`/test greet`) with daemon | first call (cold) | 1 | 643.53 | - | - | 643.53 |
| `mcpx` alias (`/test greet`) with daemon | warm calls (excluding first) | 11 | 213.29 | 212.49 | 219.39 | 207.31-222.08 |

Interpretation:

- If you compare CLI-per-call vs CLI-per-call, `mcpx` inline is close to direct MCP script speed (~7% overhead in this run).
- If alias mode can use daemon sockets, warm `/alias` calls are faster than CLI-spawned direct MCP because server startup is amortized.
- For long-lived in-process agent clients, direct MCP is much faster than any per-call CLI because process startup is eliminated.

### Note on restricted environments

In environments where Unix sockets are restricted (e.g., certain sandboxes or containers), `mcpx` daemon mode may fail with `EPERM` on `daemon.sock`. Alias-mode calls will then hit a daemon startup timeout (~5.4s per call). Running the same commands in a standard environment removes this artifact. The latency results above were collected in an unrestricted environment.

## Token-Budget Estimates (From Measured Payload Sizes)

Measured output sizes for the same fixture server:

| Payload | Bytes | Approx tokens (~4 chars/token, order-of-magnitude) |
| --- | ---: | ---: |
| Direct MCP `tools/list` payload | 1920 | 480 |
| Direct MCP `greet` call payload | 53 | 13 |
| `mcpx list /test` envelope payload | 2938 | 735 |
| `mcpx schema /test greet` envelope payload | 320 | 80 |
| `mcpx /test greet --params ...` envelope payload | 100 | 25 |

Scenario-level estimates:

| Scenario | Direct MCP | `mcpx` |
| --- | ---: | ---: |
| Known tool call only | ~13 tokens | ~25 tokens |
| Discover + call (no separate schema) | ~493 tokens (`list + call`) | ~760 tokens (`list + call`) |
| Discover + schema + call | ~493 tokens (`list + call`, schema already embedded in list) | ~840 tokens (`list + schema + call`) |

Notes:

- `mcpx` is intentionally more verbose because of envelopes and explicit schema command support.
- In exchange, parsing is simpler and more deterministic for shell/CI agents.
- These are output-side budgets only; total model usage also includes your prompt and system/tool messages.

## Gap Analysis (What This Eval Still Misses)

Current strengths:

- strong coverage of `mcpx` core contract on a real MCP fixture server
- clear exit-code and envelope behavior
- validated CLI ergonomics (`--params`, generated flags, `--field`, `--params-stdin`)

Key gaps:

| Gap | Why it matters | Current status |
| --- | --- | --- |
| Real-world server diversity | one synthetic server can hide protocol edge cases | only local fixture server is exercised |
| Desktop-client parity tests | Claude/OpenAI app behavior differs from CLI harness | no automated desktop harness in repo |
| Auth/OAuth and remote HTTP MCP | major deployment path for enterprise connectors | not exercised in local evals |
| Daemon reliability under constrained envs | timeout behavior can dominate p95 latency | discovered via sandbox, not covered by tests |
| Concurrency/load testing | agent bursts and parallel tool calls are common | no throughput/parallel benchmarks |
| Large schema and large-result stress | token/latency behavior changes materially at scale | no high-volume payload tests |
| Security behavior tests | prompt injection, unsafe tool descriptions, policy controls | no dedicated adversarial/security eval suite |

High-value next eval additions:

1. Add a second and third MCP fixture with very large schemas/results and prompt/resource support.
2. Add daemon degradation tests that assert bounded fallback latency when socket operations fail.
3. Add remote MCP integration tests (HTTP transport + auth) behind opt-in env flags.
4. Extend the benchmark runner to emit trend deltas against a saved baseline JSON.

## Automated Runner

Use the built-in benchmark runner to reproduce this report:

```bash
npm run bench
```

The runner lives at:

- `scripts/bench-mcp-vs-mcpx.ts`

Useful options:

```bash
node --import tsx scripts/bench-mcp-vs-mcpx.ts --help
node --import tsx scripts/bench-mcp-vs-mcpx.ts --compact
node --import tsx scripts/bench-mcp-vs-mcpx.ts --no-daemon
node --import tsx scripts/bench-mcp-vs-mcpx.ts --repeat 5 --timeout-ms 20000
node --import tsx scripts/bench-mcp-vs-mcpx.ts --cold-runs 10 --warm-runs 30 --spawn-runs 8
```

Output is a single JSON report containing:

- environment metadata
- config and run counts
- latency stats for direct MCP and `mcpx` paths
- payload bytes and token-budget estimates
- relative overhead ratios
- repeatability report with per-run metrics + 95% confidence intervals when `--repeat > 1`
