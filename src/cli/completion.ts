export function generateBashCompletion(): string {
  return `# mcpx bash completion
_mcpx_completions() {
  local cur prev commands
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  commands="list exec add remove update servers import skills interactive daemon schema completion resources resource alias run diff prompts prompt inspect watch"

  if [[ \${COMP_CWORD} -eq 1 ]]; then
    if [[ "\${cur}" == /* ]]; then
      # Complete server aliases
      local servers
      servers=$(mcpx servers 2>/dev/null | jq -r '.servers[].alias // empty' 2>/dev/null)
      COMPREPLY=( $(compgen -P "/" -W "\${servers}" -- "\${cur#/}") )
    else
      COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
    fi
  elif [[ \${COMP_CWORD} -eq 2 ]] && [[ "\${COMP_WORDS[1]}" == /* ]]; then
    # Complete tool names for a /server
    local tools
    tools=$(mcpx list "\${COMP_WORDS[1]}" --format json 2>/dev/null | jq -r '.tools[].name // empty' 2>/dev/null)
    COMPREPLY=( $(compgen -W "\${tools}" -- "\${cur}") )
  elif [[ \${COMP_CWORD} -eq 2 ]] && [[ "\${prev}" == "list" || "\${prev}" == "resources" || "\${prev}" == "skills" || "\${prev}" == "inspect" || "\${prev}" == "prompts" || "\${prev}" == "diff" ]]; then
    # Complete server aliases for subcommands that take a server arg
    local servers
    servers=$(mcpx servers 2>/dev/null | jq -r '.servers[].alias // empty' 2>/dev/null)
    COMPREPLY=( $(compgen -P "/" -W "\${servers}" -- "\${cur#/}") )
  elif [[ \${COMP_CWORD} -eq 2 ]] && [[ "\${prev}" == "run" ]]; then
    # Complete alias names for run command
    local aliases
    aliases=$(mcpx alias list --format json 2>/dev/null | jq -r '.result[0].text // empty' 2>/dev/null | jq -r 'keys[]' 2>/dev/null)
    COMPREPLY=( $(compgen -W "\${aliases}" -- "\${cur}") )
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
    'resources:List server resources'
    'resource:Read a resource by URI'
    'alias:Manage tool aliases'
    'run:Execute a saved alias'
    'diff:Compare tool schemas'
    'prompts:List server prompts'
    'prompt:Get a prompt template'
    'inspect:Show server info'
    'watch:Re-execute a tool periodically'
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
    args)
      case "\${words[1]}" in
        /*)
          # Complete tool names for /server
          local tools
          tools=(\${(f)"$(mcpx list "\${words[1]}" --format json 2>/dev/null | jq -r '.tools[].name // empty' 2>/dev/null)"})
          compadd $tools
          ;;
        list|resources|skills|inspect|prompts|diff)
          local servers
          servers=(\${(f)"$(mcpx servers 2>/dev/null | jq -r '.servers[].alias // empty' 2>/dev/null)"})
          compadd -P "/" $servers
          ;;
        run)
          local aliases
          aliases=(\${(f)"$(mcpx alias list --format json 2>/dev/null | jq -r '.result[0].text // empty' 2>/dev/null | jq -r 'keys[]' 2>/dev/null)"})
          compadd $aliases
          ;;
      esac
      ;;
  esac
}

_mcpx`;
}
