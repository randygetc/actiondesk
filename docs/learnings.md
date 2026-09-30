# Learnings

Friction debriefs are the owner's (KICKOFF). The eval score log below is kept by Claude Code.

## Extraction eval scores

`EVAL_LIVE=1 npm run eval` on the 19 cases in `evals/extraction/`. Scoring is in docs/plan.md §3.7.

| Date | Step | Model | Prompt | Score | Cost / case | p50 latency | What changed |
|---|---|---|---|---|---|---|---|
| 2026-09-30 | 2.3 | claude-opus-5-5 (effort medium) | extract-v1 | 90% | $0.0175 | 5.5 s | First live run |
| 2026-09-30 | 2.3 | same recordings | extract-v1 | 98% | — | — | Scorer fix: title matching by overlap with the shorter title (was Jaccard ≥ 0.5, which failed to pair correct but longer titles). Re-scored from recordings, no new API calls |
| 2026-09-30 | 2.4 | claude-haiku-4-5 (no effort/thinking, no fallback) | extract-v1 | 98% | $0.0036 | 3.0 s | Model comparison |
| 2026-09-30 | 2.4 | claude-sonnet-5-5 (effort medium) | extract-v1 | 98% | $0.0082 | 2.9 s | Model comparison |

Remaining misses (all `project`): the model put "Reply to the recruiter" in Hiring, Ana's checkout PR
in Website and the wireframes in Website, where `expected.json` says no project. These labels are
ambiguous; the owner decides whether the expected answers or the prompt should change.

## Model comparison (step 2.4, 2026-09-30)

One live run per model on the same 19 cases (recordings in `recorded.<model>.json`).

| Model | Score | Cost / case | p50 latency | Misses |
|---|---|---|---|---|
| claude-opus-5-5 | 98% | $0.0175 | 5.5 s | 3 ambiguous project labels |
| claude-sonnet-5-5 | 98% | $0.0082 | 2.9 s | 3 project labels (2 ambiguous, plus release notes put in Q4 Launch with no project named) |
| claude-haiku-4-5 | 98% | $0.0036 | 3.0 s | 1 ambiguous project; **invented a 17:00 deadline** for "by end of day" |

**Recommendation: claude-sonnet-5-5.** The owner accepted it on 2026-09-30, so `EXTRACT_MODEL` is now Sonnet 5.5, and `recorded.json` holds its recordings.
- **Same score as Opus, at 47% of the cost and about twice the speed.** Its misses are project guesses, which are visible and editable on the review screen.
- **Haiku is cheapest, but its one real error is the worst kind:** a made-up time the user may not notice. It also can't use the refusal fallback or `effort`. Its minimum cacheable prompt is 4,096 tokens, and ours is about 1,900, so prompt caching (2.6) would never apply to it (R-19).
- **Opus buys nothing measurable here** for 2× Sonnet's price and latency.

**Caveats:**
- The eval is saturated: all three models score 98%. It can't rank them finely, and one run per model doesn't show run-to-run variance.
- Harder cases (long transcripts, many tasks, conflicting dates) would separate the models better. Add them before revisiting this choice.

**Bug found:** responses name dated snapshots (`claude-haiku-4-5-20251001`). Pricing looked up the exact
id and fell back to the worst-case rate, overstating Haiku's cost 5×. `costUsd` now strips a
`-YYYYMMDD` suffix. This would also have inflated production `llm_usage` rows and the daily cap.
