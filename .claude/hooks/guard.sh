#!/bin/bash
# .claude/hooks/guard.sh

# Read the JSON payload Claude Code sends on stdin
input=$(cat)

# Extract the tool name and its input (requires jq)
tool_name=$(echo "$input" | jq -r '.tool_name')
tool_input=$(echo "$input" | jq -r '.tool_input')

# Example: block any Bash command containing "rm -rf"
if [ "$tool_name" == "Bash" ]; then
  command=$(echo "$tool_input" | jq -r '.command')
  if echo "$command" | grep -q "rm -rf"; then
    echo "Blocked: destructive rm -rf command detected." >&2
    exit 2   # non-zero exit blocks the tool call
  fi
fi

exit 0  # allow the tool call to proceed
