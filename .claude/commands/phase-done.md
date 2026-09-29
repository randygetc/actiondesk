---
description: Verify and wrap up the current step or phase
---
1. Run lint, typecheck, unit tests, `supabase test db`, e2e, and `npx depcruise --config guardrails/dependency-cruiser.cjs src`. Fix failures.
2. Update docs/plan.md: what was built, what changed from the plan, open issues.
3. Add any new conventions to docs/conventions.md (not CLAUDE.md, which is locked).
4. List anything you wanted to do but couldn't because of the architecture, and whether it deserves an ADR.
5. Commit with a conventional-commit message.
