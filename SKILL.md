# mcpx — MCP Server CLI

Execute tools on any registered MCP server. Use `--raw` (`-r`) for minimal output.

## Quick Reference

```bash
mx -r /SERVER TOOL                          # call tool (no params)
mx -r /SERVER TOOL --params '{"key":"val"}' # call with JSON params
mx -r /SERVER TOOL --field FIELD            # extract one field
mx /SERVER                                  # list server's tools
mx schema /SERVER TOOL                      # tool input schema
mx servers                                  # registered servers
mx test /SERVER                             # health check
```

## Register Servers

```bash
mx add ALIAS "npx -y @package/server"
mx add ALIAS "command" -e KEY=VALUE -e KEY2=VALUE2
mx import                                   # from Claude Desktop
mx remove ALIAS
```

## Multi-Tool Batch (one call, multiple tools)

```bash
echo '{"tool":"echo","params":{"message":"hi"}}
{"tool":"get-sum","params":{"a":1,"b":2}}' | mx batch /SERVER
```

## Key Flags

| Flag | Short | Effect |
|------|-------|--------|
| `--raw` | `-r` | Strip JSON envelope, output text only |
| `--params` | | Pass args as JSON |
| `--params-stdin` | | Read params from stdin pipe |
| `--field NAME` | | Extract one field from JSON result |
| `--dry-run` | | Preview without executing |
| `--help` | | Show tool parameters |
| `--timeout MS` | `-t` | Connection timeout |
| `--verbose` | `-v` | Show server stderr |

## Notes

- Use `--raw` for token-efficient output (35% fewer tokens)
- Use `batch` to run multiple tools in one process (5x faster)
- `mx` is a short alias for `mcpx`
- Errors go to stderr with exit codes: 0=ok, 1=tool error, 3=validation, 4=config
