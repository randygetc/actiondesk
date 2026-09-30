# Learnings

Friction debriefs are the owner's (KICKOFF). The eval score log below is kept by Claude Code.

## Extraction eval scores

`EVAL_LIVE=1 npm run eval` on the 19 cases in `evals/extraction/`. Scoring is in docs/plan.md §3.7.

| Date | Step | Model | Prompt | Score | Cost / case | p50 latency | What changed |
|---|---|---|---|---|---|---|---|
| 2026-09-30 | 2.3 | claude-opus-5-5 (effort medium) | extract-v1 | 90% | $0.0175 | 5.5 s | First live run |
| 2026-09-30 | 2.3 | same recordings | extract-v1 | 98% | — | — | Scorer fix: title matching by overlap with the shorter title (was Jaccard ≥ 0.5, which failed to pair correct but longer titles). Re-scored from recordings, no new API calls |

Remaining misses (all `project`): the model put "Reply to the recruiter" in Hiring, Ana's checkout PR
in Website and the wireframes in Website, where `expected.json` says no project. These labels are
ambiguous; the owner decides whether the expected answers or the prompt should change.
