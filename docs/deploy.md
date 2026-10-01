# Deploy runbook (step 3.10)

Production: Supabase (hosted project) + Vercel (GitHub integration, `*.vercel.app`) + Sentry.
Owner decisions (2026-10-01): a new Supabase project; Vercel deploys `main` through its GitHub
integration; the free `*.vercel.app` URL for now; the digest function is deployed but stays off until
a Resend sending domain is verified (R-33).

**Every command that touches production is confirmed by the owner first.** Steps marked
**(owner)** are done in a dashboard by the owner. Never paste keys into chat or commit them.

Placeholders: `<ref>` = Supabase project ref, `<app>` = `https://<name>.vercel.app`.

## 0. Before every deploy
- `main` is green in CI (`ci` + `guardrails`).
- Migrations to push: `supabase migration list` (local vs remote).
- **Backup:** Dashboard → Database → Backups. Free-tier projects have daily backups only, so for a
  risky migration also take a logical dump first:
  `supabase db dump --linked -f backup-$(date +%F).sql` (and `--data-only`). Keep it outside the repo.

## 1. Supabase project (first deploy)
1. **(owner)** Create the project in the Supabase dashboard. Pick the region and save the DB password in
   a password manager.
2. `supabase login` (interactive, owner: `! supabase login`).
3. `supabase link --project-ref <ref>` (asks for the DB password).
4. `supabase db push --dry-run`, then `supabase db push`. This applies all migrations, including the
   `pg_cron` and `pg_net` extensions and the `attachments` bucket.
5. Check: `supabase migration list` shows local = remote. The table editor shows RLS enabled on every
   table.

## 2. Auth (owner, dashboard → Authentication)
- **URL configuration:** Site URL = `<app>`. Redirect URLs: `<app>/auth/callback`.
  The login action sends the request's own origin, so a URL not in this list falls back to the
  Site URL. Preview deployments don't sign in unless their URL is added (a wildcard like
  `https://*-<team>.vercel.app/auth/callback` works).
- **Providers:**
  - **Google** on, with the prod OAuth client's id and secret.
  - **Email: turn off sign-up and password sign-in (D-8).** Email/password is for local and CI only.
- **Google Cloud console (owner):** on the OAuth client, add the authorized redirect URI
  `https://<ref>.supabase.co/auth/v1/callback`, and `<app>` as an authorized JavaScript origin.
- **MFA (R-32):** enable TOTP enroll and verify. Without it, owners can't delete workspaces or remove
  members (those need aal2).
- **Admins:** after the owner's first sign-in, add them in the SQL editor:
  `insert into public.app_admins (user_id) values ('<uuid>');`

## 3. Edge Function and cron
1. `supabase functions deploy digest` (`verify_jwt = false` comes from `config.toml`; the function
   checks callers itself).
2. Function secrets, set without echoing them (each one is typed by the owner):
   `supabase secrets set --env-file <file outside the repo>`, with:
   - `ANTHROPIC_API_KEY`, `LLM_DAILY_CAP_USD`, `APP_URL=<app>`
   - `SENTRY_DSN`, `SENTRY_ENVIRONMENT=production`
   - when the digest is turned on: `EMAIL_TRANSPORT=resend`, `RESEND_API_KEY`, `DIGEST_FROM`
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically.
3. **Turning the digest on (R-33, later).** Verify the sending domain in Resend and set the three email
   secrets above. Then add the Vault secrets in the SQL editor (never in a migration):
   ```sql
   select vault.create_secret('https://<ref>.supabase.co/functions/v1/digest', 'digest_function_url');
   select vault.create_secret('<legacy service_role JWT>', 'service_role_key');
   ```
   The function accepts the scheduled call only if this equals the `SUPABASE_SERVICE_ROLE_KEY` that
   Supabase injects into it. On hosted projects, that's the **legacy `service_role` JWT** (Settings →
   API Keys → Legacy), not the `sb_secret_…` key. Check it with one manual run before relying on cron.
   Until both exist, the hourly cron job (`weekly-digest`) runs and does nothing.
   Check it with `select * from cron.job_run_details order by start_time desc limit 5;`.

## 4. Vercel (owner, dashboard)
1. Add New → Project → import `randygetc/actiondesk`. Framework: Next.js. Production branch: `main`.
2. Environment variables (Production; Preview too, if previews should work):
   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | the `sb_publishable_…` key |
   | `ANTHROPIC_API_KEY` | prod key (sensitive) |
   | `LLM_DAILY_CAP_USD` | e.g. `1` |
   | `NEXT_PUBLIC_SENTRY_DSN` | the DSN |
   | `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | source maps (R-36) |
   Mark the keys and the token **Secret**; everything else (including all `NEXT_PUBLIC_*`) is **Config**.
   Never set `LLM_FAKE` or `ALLOW_DEBUG_ERROR` in production.
   **No `SUPABASE_SERVICE_ROLE_KEY` in Vercel:** nothing in the app imports the admin client
   (`src/lib/supabase/admin.ts`), so the web app doesn't get a key that bypasses RLS. Add it only
   when code under `src/lib/admin/**` needs it. The digest function gets it from Supabase.
3. Deploy. Then copy the production URL into step 2 (Site URL and redirect) and into `APP_URL`
   (step 3).
4. Function region: set it next to the Supabase region (Settings → Functions) so every query doesn't
   cross an ocean.

## 5. Smoke test (after every deploy)
- `curl -s <app>/api/health` → `{"status":"ok","checks":{"auth":true,"db":true},"release":"<sha>"}`.
- `<app>/api/debug/error` → 404 (it's disabled in production).
- Sign in with Google → `/tasks`. Create a project and a task, complete it, then reload.
- Capture: paste a short note, review, save. Ask: one question. Check `llm_usage` for both rows.
- Settings → Security: set up TOTP.
- A second Google account: invite, accept, check that live updates arrive in the other tab.
- Sentry: the release shows up, and a deliberate client error has a readable stack trace.

## 6. Monitoring (R-37)
- **(owner)** Sentry → Uptime → add a monitor for `<app>/api/health` (1 min interval) with alerts
  to the owner's email.
- Sentry alert rule: a new issue, or more than 10 events in 5 minutes.

## 7. Rollback
- **App:** Vercel → Deployments → the last good one → "Promote to Production" (instant; no rebuild).
- **Database:** forward-fix only (R7). Write a new migration that undoes the change, push it after a
  backup. The 3.2 policy rollback is ready in `docs/rollback/workspaces-policies.sql`.
- **Data loss:** restore from the dashboard backup (point in time only on paid plans) or the
  logical dump from step 0.
- **Turn off AI fast:** set `LLM_DAILY_CAP_USD=0` in Vercel (redeploy) and in the function secrets.
  Every LLM path checks the cap first.

## Privacy notes (R-29)
- Workspace members can see each other's display names (needed for assignees and the member list).
- Logs and Sentry carry ids and counts only, never note or task text (rule 12, the 3.8 scrubber).

## Deploy log
| Date | What | Result |
|---|---|---|
| 2026-10-01 | Project `obssgmldayxyniyzlpgg` created (us-west-1, Postgres 17); `supabase link`; `db push` of 17 migrations (empty database, so no backup) | local = remote; 10 tables, 26 policies (same as local), RLS on all; `weekly-digest` cron scheduled, dormant (no Vault secrets) |
| 2026-10-01 | `supabase functions deploy digest` (v1, `verify_jwt=false`) | ACTIVE; GET → 405, scheduled POST without the service key → 401 |
| 2026-10-01 | Function secrets: `ANTHROPIC_API_KEY`, `LLM_DAILY_CAP_USD`, `SENTRY_ENVIRONMENT` (owner, dashboard); `SENTRY_DSN` set from `.env.local` by CLI, misnamed `NEXT_PUBLIC_SENTRY_DSN` removed | all 4 present; `APP_URL` and the email secrets still to add |
| 2026-10-01 | First Vercel deploy (`3bcf1ea`); Google sign-in reached Supabase but the code exchange failed: Vercel's publishable key wasn't this project's (health `auth:false`, 0 sessions, unredeemed flow states) | owner fixing the key in Vercel |
| 2026-10-01 | `db push` of `health_check` (hosted Supabase refuses `/rest/v1/` with a publishable key) | `health_check()` returns true via REST with the publishable key |
| 2026-10-01 | Owner's Vercel key fix + redeploy | health `auth:true`; Google sign-in works, session created |
