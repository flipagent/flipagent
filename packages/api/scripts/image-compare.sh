#!/usr/bin/env bash
# Clean head-to-head: image ON vs OFF for two models, 3 reps each.
set -u
SNAP="${SNAP:-scripts/.bench-out/snap-2026-05-02T22-32-45-832Z.json}"
SEED="v1|277337757498|0"

flush() {
  PGPASSWORD=flipagent psql -h localhost -p 55432 -U flipagent -d flipagent \
    -c "delete from match_decisions where candidate_id = '$SEED';" >/dev/null 2>&1
}

run() {
  local label="$1" prov="$2" var="$3" model="$4" img="$5"
  for rep in 1 2 3; do
    flush
    out=$(env MODE=match SNAPSHOT="$SNAP" APIKEY_ID=d3b36b4f-4e4d-41a5-94e6-1b57f3d7261d \
      USE_IMAGES="$img" LLM_PROVIDER="$prov" "${var}=${model}" LLM_MAX_CONCURRENT=16 VERIFY_CHUNK=10 \
      node --env-file=.env --import tsx scripts/match-bench.ts 2>&1 | tail -2 | head -1)
    echo "[$label img=$img rep=$rep] $out"
  done
}

run "gpt-5.4-mini" openai OPENAI_MODEL gpt-5.4-mini true
run "gpt-5.4-mini" openai OPENAI_MODEL gpt-5.4-mini false
run "gemini-3.1-lite-prev" google GOOGLE_MODEL gemini-3.1-flash-lite-preview true
run "gemini-3.1-lite-prev" google GOOGLE_MODEL gemini-3.1-flash-lite-preview false

echo ""
echo "=== F1 SCORES ==="
LABELS=scripts/.bench-out/labels-casio-ga2100.json SNAPSHOT="$SNAP" \
  node --import tsx scripts/match-score.ts 2>&1 | head -16
