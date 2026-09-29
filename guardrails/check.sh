#!/usr/bin/env bash
# ActionDesk CI guardrail checks. LOCKED — see docs/architecture.md §6.
# Runs on pull requests. Needs full git history (fetch-depth: 0).
#   BASE_REF   branch to compare against (default origin/main)
#   PR_LABELS  comma-separated PR labels
set -euo pipefail

BASE="${BASE_REF:-origin/main}"
fail=0

# R7 / ADR-0005: committed migrations are append-only.
changed_migrations="$(git diff --name-only --diff-filter=MDR "$BASE"...HEAD -- supabase/migrations || true)"
if [ -n "$changed_migrations" ]; then
  echo "::error::Committed migrations were modified, renamed, or deleted (ADR-0005). Add a new migration instead:"
  echo "$changed_migrations"
  fail=1
fi

# Locked paths need the owner's explicit approval label.
LOCKED='^(CLAUDE\.md$|docs/architecture\.md$|docs/adr/|\.claude/|guardrails/|\.github/workflows/guardrails\.yml$|\.github/CODEOWNERS$|supabase/tests/000_rls_enabled\.test\.sql$)'
touched="$(git diff --name-only "$BASE"...HEAD | grep -E "$LOCKED" || true)"
if [ -n "$touched" ]; then
  if [[ ",${PR_LABELS:-}," == *",architecture-approved,"* ]]; then
    echo "Locked paths changed, approved via 'architecture-approved' label:"
    echo "$touched"
  else
    echo "::error::Locked architecture paths changed without the 'architecture-approved' label:"
    echo "$touched"
    fail=1
  fi
fi

if [ "$fail" -eq 0 ]; then echo "Guardrail checks passed."; fi
exit "$fail"
