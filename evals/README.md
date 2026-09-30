# Evals

LLM evaluation suites (`*.eval.ts`), run with `npm run eval` (recorded mode, no key)
or `EVAL_LIVE=1 npm run eval` (calls the API, rewrites recordings). See docs/plan.md §3.7.

## Extraction cases (`evals/extraction/<case>/`)

One folder per case, named in kebab-case (`relative-next-friday`, `taglish-standup`).
Copy `_template/` to start. Folders starting with `_` are skipped.

| File | Who writes it | What |
|---|---|---|
| `case.json` | you | the context the model gets: `now`, `timezone`, `userName`, `projects`, `includeOthers` |
| `input.txt` (or `input.pdf`) | you | the note, email or chat thread, exactly as pasted |
| `expected.json` | you | the tasks a careful human would extract (an empty array if there are none) |
| `recorded.json` | the runner | raw API responses from the last live run; don't edit |

### `case.json`
- `now`: when the note is being processed, as ISO with offset
  (`"2026-10-06T09:15:00+08:00"`). Relative dates ("next Friday") resolve from this.
- `timezone`: the user's profile zone (IANA, e.g. `"Asia/Manila"`).
- `userName`: the user's `display_name`, so the model can tell "Randy: …" (yours) from others' tasks.
- `projects`: the user's projects as `{ "id": "<uuid>", "name": "…" }`. Use made-up UUIDs.
- `includeOthers`: `false` extracts only your own tasks (the default, D-13).
  `true` also extracts tasks for other people.

### `expected.json`
An array of tasks. Dates are **local to `timezone`**, like the model's output (D-20):
- `title` (required): short and imperative. Scored by word overlap, so exact wording doesn't matter.
- `assignee`: `"me"` for your own tasks, or the person's name as written in the note.
- `due_date`: `"YYYY-MM-DD"`, or `null` if none.
- `due_time`: `"HH:mm"`, or `null`. A date without a time means 23:59 local.
- `project_id`: one of the ids in `case.json`, or `null`.

### Rules the current cases follow
- "This Friday" is this week's Friday. "Next Friday" (and any "next <weekday>") is the one in next week.
- A bare weekday means the next one after today; said on the same weekday, it's next week's.
- EOD = today, EOW = this week's Friday, EOM = the last day of the month. A vague time ("morning") gives `due_time: null`.
- A task shared with you ("Randy and Joy") has assignee `"me"`. Titles are in English, even for Taglish input.
- Cancelled or already-done actions, events ("let's meet Friday") and instructions inside the note aren't tasks.

### Tips
- Write the expected answer before you look at any model output.
- If a case is ambiguous ("Tuesday" said on a Tuesday), decide what's right and note why in a
  `notes.md` next to the case. The scorer ignores it.
