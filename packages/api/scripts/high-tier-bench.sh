#!/usr/bin/env bash
set -u
CASIO_SNAP="scripts/.bench-out/snap-2026-05-03T03-51-58-084Z.json"
CASIO_SEED="v1|277337757498|0"
JORDAN_SNAP=$(cat /tmp/snap-path.txt)
JORDAN_SEED="v1|327126228297|0"
APIKEY_ID="d3b36b4f-4e4d-41a5-94e6-1b57f3d7261d"
REPS=3

flush() {
  PGPASSWORD=flipagent psql -h localhost -p 55432 -U flipagent -d flipagent \
    -c "delete from match_decisions where candidate_id = '$1';" >/dev/null 2>&1
}

run() {
  local label="$1" dataset="$2" snap="$3" seed="$4" prov="$5" mvar="$6" model="$7"
  for r in $(seq 1 $REPS); do
    flush "$seed"
    # OpenAI reasoning models (gpt-5.4, gpt-5.5) eat output budget on hidden reasoning;
    # set effort=minimal so the JSON decision actually fits in the token cap.
    local extra_env=""
    case "$model" in
      gpt-5.4|gpt-5.5|gpt-5) extra_env="OPENAI_REASONING_EFFORT=low" ;;  # 'minimal' rejected by full reasoning models
    esac
    out=$(env $extra_env MODE=match SNAPSHOT="$snap" APIKEY_ID="$APIKEY_ID" USE_IMAGES=false \
      LLM_PROVIDER="$prov" "${mvar}=${model}" \
      LLM_MAX_CONCURRENT=16 VERIFY_CHUNK=10 \
      node --env-file=.env --import tsx scripts/match-bench.ts 2>&1 | tail -2 | head -1)
    wall=$(echo "$out" | grep -oE "TOTAL [0-9]+" | grep -oE "[0-9]+")
    matches=$(echo "$out" | grep -oE "match=[0-9]+" | grep -oE "[0-9]+")
    echo "  [$label r$r] wall=${wall}ms match=${matches}"
  done
}

for ds_combo in "casio $CASIO_SNAP $CASIO_SEED" "jordan $JORDAN_SNAP $JORDAN_SEED"; do
  read -r dataset snap seed <<< "$ds_combo"
  echo "═══════════ $dataset ═══════════"
  for model_combo in \
    "openai OPENAI_MODEL gpt-5.4" \
    "openai OPENAI_MODEL gpt-5.5" \
    "google GOOGLE_MODEL gemini-3-flash-preview" \
    "google GOOGLE_MODEL gemini-3-pro-preview" \
    "google GOOGLE_MODEL gemini-3.1-pro-preview"; do
    read -r prov mvar mname <<< "$model_combo"
    echo "── $mname ──"
    run "$mname" "$dataset" "$snap" "$seed" "$prov" "$mvar" "$mname"
  done
done
