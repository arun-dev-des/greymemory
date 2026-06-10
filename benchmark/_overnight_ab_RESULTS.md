# Overnight A/B results — Phase 0 + Phase 1 (recall/rerank/reading)

Run: 2026-06-10, branch `feat/recall-rerank-readingv2`.

> **Caveat — NOT gpt-4o-comparable.** The `OPENAI_API_KEY` in `.env` is invalid
> ("Incorrect API key provided"), so the answerer+judge ran on the Anthropic
> fallback (**Sonnet 4.6 answerer + Haiku 4.5 judge**). The judge is held
> CONSTANT across old-vs-new, so the **A/B deltas are valid**, but absolute
> numbers are not comparable to supermemory's gpt-4o 81.6%. Refresh the OpenAI
> key and re-run with the default provider for a comparable headline.

Harness: `benchmark/_overnight_ab.sh` (all knobs env-driven in `benchmark/run.js`).

## Configs
- **NEW**: CoN v2 + RERANK + MULTI_QUERY=2 + ADAPTIVE_AGG + MAX_PER_SESSION=2 (+ all Phase 0 code fixes)
- **BASELINE flags**: CoN v1, no rerank/mq/adaptive (Phase 0 code fixes still active — they can't be toggled off)

## Smoke-6 — 1 question per category (session-mode ingest, same DB for both)
| category | acc NEW | acc BASE | N@10 NEW | N@10 BASE |
|---|---|---|---|---|
| single-session-user | 100 | 100 | 100 | 100 |
| single-session-assistant | 100 | 100 | 100 | 100 |
| single-session-preference | 100 | 100 | 100 | 100 |
| knowledge-update | 100 | 100 | 100 | 100 |
| temporal-reasoning | 100 | 100 | 100 | 100 |
| multi-session | 100 | 100 | **96.7** | **87.1** |
| **overall** | **100** | **100** | **99.5** | **97.9** |
R@10 = 100% everywhere, both configs.

## KU-10 — fixed reproducible set (existing DB, free)
| | acc | R@10 | N@10 |
|---|---|---|---|
| NEW | 100 | 95 | **91.6** |
| BASELINE | 100 | 95 | **94.1** |

## Findings
1. **End-to-end validated across all 6 categories** — no crashes, retries, rate
   limits, or degraded answers. Phase 0 fixes + Phase 1 levers all execute.
2. **Accuracy is saturated at 100% on BOTH configs** at this scale. With a strong
   answerer and n=1/category (n=10 for KU), there is **no accuracy signal** to
   distinguish configs — expected at this sample size (the plan notes ±15pp CI).
3. **Only ranking (NDCG@10) moved:** rerank **helped multi-session (+9.6)** but
   **slightly hurt knowledge-update (−2.5)**. Early signal (small n): the LLM
   reranker pays off where recall is the bottleneck (MS/TR) and is neutral-to-
   negative where retrieval is already near-perfect (KU). → **gate rerank to
   recall-limited categories**, don't apply universally. Confirm at larger n.
4. **Ingest cost is dominated by relationship classification:** smoke-6 ingest =
   $4.08 Haiku from **286 extraction + 1080 relationship calls** (~180
   relationship calls / question). This confirms plan Task 8.1 (batch
   relationship detection into one call/session) as the top cost lever — it
   would cut ingest cost ~5×.
5. Eval phases are cheap: KU-10 NEW (rerank+mq) = $0.022 Haiku + ~$0.1 Sonnet/Haiku.

## Spend
~$5 total: $4.08 Haiku (mostly smoke ingest), ~$1 Sonnet/Haiku answer+judge.

## Recommended next steps
1. **Refresh `OPENAI_API_KEY`** → re-run with default provider (gpt-4o answerer+judge) for a comparable headline.
2. **Do NOT blindly scale ingest** — relationship calls make a 90-question session-mode ingest ~$50+. Implement Task 8.1 (batch relationship) first, OR persist one all-category DB and reuse it (SKIP_INGEST) across configs.
3. **Gate rerank to MS/TR** (where recall is the bottleneck) rather than all categories; re-measure NDCG/accuracy at n≥15/category.
4. Larger n (≥15/category) is required for any accuracy claim — current n saturates.
