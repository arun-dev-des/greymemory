#!/usr/bin/env bash
# Overnight A/B orchestration (Anthropic fallback: Sonnet answerer + Haiku judge,
# because the OpenAI key in .env is invalid). All numbers are Claude-judged and
# NOT directly comparable to supermemory's gpt-4o figures — but the judge is held
# CONSTANT across old-vs-new, so the A/B DELTAS are valid.
#
# Phases:
#   1. SMOKE-6  ingest 1 question/category (session mode) + eval NEW config   (paid ingest)
#   2. SMOKE-6  eval BASELINE flags on the same DB (free; SKIP_INGEST)
#   3a. KU-10   eval NEW config on existing DB (free)
#   3b. KU-10   eval BASELINE flags on existing DB (free)
set -uo pipefail
cd /Users/ma2072/Documents/greymemory
OUT=/tmp/greymem_overnight
mkdir -p "$OUT"
SMOKE_DB=benchmark/.greymemory-bench-smoke6
KU_DB=benchmark/.greymemory-bench-ku10-validation
COMMON="ANSWERER_PROVIDER=anthropic JUDGE_PROVIDER=anthropic QUESTION_DELAY_MS=2000"
latest() { ls -t benchmark/results/run-*.json 2>/dev/null | head -1; }

echo "##### OVERNIGHT A/B START $(date) #####"

echo; echo "===== PHASE 1: SMOKE-6 ingest + NEW config $(date) ====="
env DB_DIR=$SMOKE_DB SKIP_INGEST=false USE_FIXED_IDS=false CATEGORY_FILTER=all PER_CATEGORY=1 \
    EXTRACTION_MODE=session CON_PROMPT_VERSION=v2 RERANK=1 MULTI_QUERY=2 ADAPTIVE_AGG=1 MAX_PER_SESSION=2 \
    ANSWERER_PROVIDER=anthropic JUDGE_PROVIDER=anthropic QUESTION_DELAY_MS=2000 \
    node benchmark/run.js > "$OUT/phase1_smoke_new.log" 2>&1
cp "$(latest)" "$OUT/phase1_smoke_new.json" 2>/dev/null && echo "  -> $OUT/phase1_smoke_new.json"

echo; echo "===== PHASE 2: SMOKE-6 BASELINE flags (free) $(date) ====="
env DB_DIR=$SMOKE_DB SKIP_INGEST=true USE_FIXED_IDS=false CATEGORY_FILTER=all PER_CATEGORY=1 \
    CON_PROMPT_VERSION=v1 RERANK=0 ADAPTIVE_AGG=0 \
    ANSWERER_PROVIDER=anthropic JUDGE_PROVIDER=anthropic QUESTION_DELAY_MS=2000 \
    node benchmark/run.js > "$OUT/phase2_smoke_baseline.log" 2>&1
cp "$(latest)" "$OUT/phase2_smoke_baseline.json" 2>/dev/null && echo "  -> $OUT/phase2_smoke_baseline.json"

echo; echo "===== PHASE 3a: KU-10 NEW config (free) $(date) ====="
env DB_DIR=$KU_DB SKIP_INGEST=true USE_FIXED_IDS=true CATEGORY_FILTER=knowledge-update \
    CON_PROMPT_VERSION=v2 RERANK=1 MULTI_QUERY=2 ADAPTIVE_AGG=1 \
    ANSWERER_PROVIDER=anthropic JUDGE_PROVIDER=anthropic QUESTION_DELAY_MS=2000 \
    node benchmark/run.js > "$OUT/phase3a_ku10_new.log" 2>&1
cp "$(latest)" "$OUT/phase3a_ku10_new.json" 2>/dev/null && echo "  -> $OUT/phase3a_ku10_new.json"

echo; echo "===== PHASE 3b: KU-10 BASELINE flags (free) $(date) ====="
env DB_DIR=$KU_DB SKIP_INGEST=true USE_FIXED_IDS=true CATEGORY_FILTER=knowledge-update \
    CON_PROMPT_VERSION=v1 RERANK=0 \
    ANSWERER_PROVIDER=anthropic JUDGE_PROVIDER=anthropic QUESTION_DELAY_MS=2000 \
    node benchmark/run.js > "$OUT/phase3b_ku10_baseline.log" 2>&1
cp "$(latest)" "$OUT/phase3b_ku10_baseline.json" 2>/dev/null && echo "  -> $OUT/phase3b_ku10_baseline.json"

echo; echo "##### OVERNIGHT A/B COMPLETE $(date) #####"
