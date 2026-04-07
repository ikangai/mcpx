export function generateBashCompletion(): string {
  return `# mcpx bash completion
_mcpx_completions() {
  local cur prev commands
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  commands="list exec add remove update servers import skills interactive daemon schema completion"

  if [[ \${COMP_CWORD} -eq 1 ]]; then
    if [[ "\${cur}" == /* ]]; then
      # Complete server aliases
      local servers
      servers=$(mcpx servers 2>/dev/null | jq -r '.servers[].alias // empty' 2>/dev/null)
      COMPREPLY=( $(compgen -P "/" -W "\${servers}" -- "\${cur#/}") )
    else
      COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
    fi
  fi
}
complete -F _mcpx_completions mcpx`;
}

export function generateZshCompletion(): string {
  return `# mcpx zsh completion
#compdef mcpx

_mcpx() {
  local -a commands
  commands=(
    'list:List available tools'
    'exec:Execute an MCP tool'
    'add:Register an MCP server'
    'remove:Remove a registered server'
    'update:Update a server config'
    'servers:List registered servers'
    'import:Import from Claude Desktop'
    'skills:Generate agent skill docs'
    'interactive:Start REPL mode'
    'daemon:Manage connection daemon'
    'schema:Show tool schema'
    'completion:Generate shell completion'
  )

  _arguments '1:command:->command' '*::arg:->args'

  case $state in
    command)
      if [[ "$words[2]" == /* ]]; then
        local servers
        servers=(\${(f)"$(mcpx servers 2>/dev/null | jq -r '.servers[].alias // empty' 2>/dev/null)"})
        compadd -P "/" $servers
      else
        _describe 'command' commands
      fi
      ;;
  esac
}

_mcpx`;
}
