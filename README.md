# ActionDesk starter kit

Seed files for the ActionDesk repo, with the architecture locked so Claude Code can propose changes but not make them.

1. Unzip into an empty folder, `chmod +x .claude/hooks/guard.sh guardrails/check.sh`.
2. Follow **docs/KICKOFF.md** from section 0.

| Path | What it is | Claude Code can edit? |
|---|---|---|
| CLAUDE.md | Project instructions; imports architecture + conventions | No |
| docs/architecture.md | Tiers, trust boundaries, rules R1–R7, enforcement map | No |
| docs/adr/ | Decision records 0001–0005 + template | No |
| docs/conventions.md | Conventions learned while building | Yes |
| docs/plan.md | Working plan (written in step 1.1) | Yes |
| docs/KICKOFF.md | The phase-by-phase guide | Yes (it's your guide; Claude doesn't need to) |
| .claude/settings.json | Permissions, deny rules, hooks | No |
| .claude/hooks/guard.sh | **Not included.** `settings.json` calls it; add your own or remove the `PreToolUse` hook (see KICKOFF section 0) | — |
| .claude/commands/ | /migrate, /phase-done, /propose-adr | No |
| .claude/agents/security-reviewer.md | Review subagent | No |
| guardrails/ | dependency-cruiser rules + CI check script | No |
| .github/workflows/guardrails.yml | Required CI check | No |
| .github/CODEOWNERS | Ownership of locked paths | No |
| supabase/tests/000_rls_enabled.test.sql | Fails if any public table lacks RLS | No |
