# Your choices on the plan

- **Written:** 2026-09-29, after step 1.1
- **Source:** docs/plan.md §6 (open decisions) and §7 (risks and guardrail gaps)

You have 18 decisions in plan §6 and four guardrail fixes in §7 that only you can make. Only D-1, D-2, D-8 and D-9 matter before coding starts. Every item has a recommendation, so for any you don't care about, "accept as recommended" is a fine answer.

## Decide now: these affect Phase 1

**D-1. How Phase 1 rows are keyed**
- **A: `owner_id` now, move to `workspace_id` in Phase 3** (recommended). This is simpler now, and KICKOFF 3.1–3.2 is a whole exercise built around migrating live data into workspaces. Choosing B makes that exercise pointless.
- **B: `workspace_id` from day one.** Less rework later, but Phase 1 then needs workspaces, members and the `is_member()` helper before any real feature exists.

**D-2. Should the plan spell out `projects` in detail?**
Step 1.6 is meant to be a deliberately vague prompt ("Add projects CRUD") that you compare against 1.7's full spec. Claude reads `plan.md` every session, so a detailed projects section would quietly turn the vague prompt into a specified one.
- **A: cut the detailed 1.6 acceptance criteria from the plan** and keep only the table and its access rules (recommended if you want an honest comparison).
- **B: keep them.** You get better code at 1.6, but that exercise's result is contaminated.

**D-8. How the end-to-end tests sign in without Google**
- **A: email/password enabled only locally and in CI.** Playwright signs in seeded users directly and sets the cookies (recommended). Production stays Google-only.
- **B: mock the OAuth flow.** More realistic, but fragile.
- **C: a test-only login route.** Easy, but it's a backdoor that could ship to production by mistake.

**D-9. Step 1.4 needs a migration already on `main`**
One of 1.4's four violations is editing a migration that's already committed to `main`. No migration exists yet.
- **A: run 1.4 after the 1.5 PR is merged**, since 1.5 creates the `profiles` migration.
- **B: merge a small placeholder migration in 1.3** so 1.4 can run in order.

**D-10. `server-only` package placement:** a runtime dependency (recommended, because it runs in the production bundle) or a dev dependency. This is minor.

## Decide by 1.7: tasks and recurrence

- **D-3. When a project is deleted:** archiving is the normal path, and a hard delete sets its tasks' `project_id` to null, with a warning showing the task count (recommended). Alternatives: cascade-delete the tasks (data loss), or block deletion while tasks exist (annoying).
- **D-4. Priority levels:** `low / normal / high / urgent` (recommended), or a 1–5 number, or three levels.
- **D-5. Which timezone a recurring task follows:**
  - **A: the task stores its own `recurrence_tz` when it's created** (recommended). A 9am Pacific standup stays 9am Pacific even if you move to Manila.
  - **B: the profile's current timezone.** It's simpler, but changing your timezone shifts every recurring task.
- **D-6. What "This week" means, and whether raw RRULE input is allowed:** weeks start Monday and recurrence comes from presets only (recommended). Raw RRULE input means users can enter anything, which needs more validation and testing.
- **D-7. How the next occurrence is scheduled:**
  - **A: from the schedule.** The next occurrence comes after the previous due date and is also in the future (recommended). If you finish an overdue daily task a week late, you get one new task, not seven.
  - **B: from the completion date.** "Every 7 days" drifts to whenever you actually finished it.

## Phase 2 and 3 decisions (can wait until 2.1 or 3.1)

- **D-11. Who counts as an admin for the usage page:** an `app_admins` table that only you insert into with SQL (recommended), or an environment variable listing email addresses.
- **D-12. How LLM usage rows get written:** through one locked-down database function, with no direct insert permission (recommended). This stops users from writing fake usage rows.
- **D-13. The "owner" named in extracted tasks** (for example, "Bob will send the deck"): store it as free text in `assignee_text` and extract only your own tasks by default (recommended). Phase 2 has no other users to link to anyway.
- **D-14. Saving pasted meeting notes:** don't save them. Keep only the tasks you accept, plus a short source quote (recommended). This stores less sensitive data and fits rule 12's ban on logging note contents.
- **D-15. Ask assistant output:** plain text with no chat history (recommended), or rendered Markdown, which needs a sanitizer because model output is untrusted (rule 7).
- **D-16. How invites are accepted:** a locked-down database function. The token is stored hashed, and the accepting email must match the invite (recommended).
- **D-17. Deleting a workspace:** soft delete with a purge job later (recommended), or hard delete behind a second authentication factor.
- **D-18. Sending invites:** share a link first, and add email once an email provider is chosen at 3.6 (recommended).

## Guardrail fixes only you can make (plan §7)

These involve locked files, so Claude can't change them.
- **R-1: the migration-protection hook doesn't exist.** architecture.md §6 names `protect-migrations.sh`, but the only hook is `guard.sh`, and it only blocks `rm -rf`. CI still catches edited migrations. Your options: add the hook, or correct §6 to say CI is the only check.
- **R-2: ESLint is listed as enforcement but doesn't exist.** §6 lists ESLint import restrictions for R2 and R3, but there's no ESLint config. One created at 1.3 would be a file Claude can edit. Your options: add the ESLint config to the locked paths after 1.3, or remove that row from §6.
- **R-3: the dependency-cruiser client-import rule only checks `src/components/`.** A `"use client"` file under `src/app/` could import LLM code, and only a build error would catch it. Your options: widen the rule, or accept the convention that client components live in `src/components/`.
- **R-4: CODEOWNERS has a placeholder username.** Fix it in 1.2.

## Suggestion

Accept all recommendations except D-2: cut the detailed projects criteria so 1.6 stays a real test. For D-9, choose A. Then do the §7 fixes as part of 1.2. Once you've made your picks, they get recorded in `docs/plan.md`.
