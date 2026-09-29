# Conventions

Editable by Claude Code. Record project conventions learned while building (naming, folder patterns,
test helpers, UI patterns). Conventions must not contradict docs/architecture.md; if one would,
propose an ADR instead.

<!-- Add entries below, newest last. -->

## LLM tools that need data RLS hides (2026-09-29)
LLM tools never use the admin client (ADR-0003; a proposed ADR-0006 to allow it was rejected by the owner).
If a tool needs data the user's RLS policies don't expose:
- Add a narrow `security definer` function in a **new** migration.
- The function checks `is_member(workspace_id, min_role)` itself and returns only the columns the tool needs.
- Add pgTAP tests for it, including one where user B cannot reach user A's data.
- The tool calls it via `.rpc()` on the user-scoped client.
