#!/usr/bin/env bash
# Sequential bake-off: clear decision-cache between each model so no
# cross-model contamination of cached verify decisions.
set -euo pipefail

SNAP="${SNAP:-scripts/.bench-out/snap-2026-05-02T22-32-45-832Z.json}"
APIKEY_ID="${APIKEY_ID:-d3b36b4f-4e4d-41a5-94e6-1b57f3d7261d}"
SEED_ITEM_ID="${SEED_ITEM_ID:-v1|277337757498|0}"

clear_cache() {
  PGPASSWORD=flipagent psql -h localhost -p 55432 -U flipagent -d flipagent \
    -c "delete from match_decisions where candidate_id = '${SEED_ITEM_ID}';" \
    >/dev/null 2>&1
}

run_model() {
  local provider="$1"
  local model_var="$2"
  local model="$3"
  echo ""
  echo "=================================================="
  echo " ${provider}/${model}"
  echo "=================================================="
  clear_cache
  env MODE=match SNAPSHOT="$SNAP" APIKEY_ID="$APIKEY_ID" MATCHER_TRACE=1 \
    LLM_PROVIDER="$provider" "${model_var}=${model}" \
    node --env-file=.env --import tsx scripts/match-bench.ts 2>&1 | tail -25
}

run_model google GOOGLE_MODEL gemini-2.5-flash
run_model google GOOGLE_MODEL gemini-2.5-flash-lite
run_model google GOOGLE_MODEL gemini-3-flash-preview
run_model google GOOGLE_MODEL gemini-3.1-flash-lite-preview
run_model openai OPENAI_MODEL gpt-5.4-mini
run_model openai OPENAI_MODEL gpt-5.4-nano

echo ""
echo "=================================================="
echo " SCORE"
echo "=================================================="
LABELS=scripts/.bench-out/labels-casio-ga2100.json SNAPSHOT="$SNAP" \
  node --import tsx scripts/match-score.ts | head -30
