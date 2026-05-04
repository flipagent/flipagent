#!/usr/bin/env bash
# Full matrix bake-off: model × chunk × strategy × dataset
set -u

CASIO_SNAP="scripts/.bench-out/snap-2026-05-03T03-51-58-084Z.json"
CASIO_SEED="v1|277337757498|0"
CASIO_LABELS="scripts/.bench-out/labels-casio-ga2100-v3-manual.json"
JORDAN_SNAP=$(cat /tmp/snap-path.txt)
JORDAN_SEED="v1|327126228297|0"
JORDAN_LABELS="scripts/.bench-out/labels-jordan4-blackcat-sz12.json"
APIKEY_ID="d3b36b4f-4e4d-41a5-94e6-1b57f3d7261d"
REPS=3

# Output collector
RESULTS_FILE="scripts/.bench-out/matrix-results.tsv"
echo -e "dataset\tmodel\tchunk\tstrategy\trep\twall_ms\tmatch_count" > "$RESULTS_FILE"

flush_cache() {
  PGPASSWORD=flipagent psql -h localhost -p 55432 -U flipagent -d flipagent \
    -c "delete from match_decisions where candidate_id = '$1';" >/dev/null 2>&1
}

run_config() {
  local label="$1" dataset="$2" snap="$3" seed="$4" model_var="$5" model="$6" provider="$7" chunk="$8" strategy="$9"
  local concur=16
  if [ "$chunk" -le 5 ]; then concur=32; fi
  for r in $(seq 1 $REPS); do
    flush_cache "$seed"
    local script
    if [ "$strategy" = "ensemble2" ]; then
      script="scripts/match-bench-ensemble.ts"
      out=$(env SNAPSHOT="$snap" APIKEY_ID="$APIKEY_ID" USE_IMAGES=false \
        LLM_PROVIDER="$provider" "${model_var}=${model}" \
        LLM_MAX_CONCURRENT="$concur" VERIFY_CHUNK="$chunk" ENSEMBLE_N=2 \
        node --env-file=.env --import tsx "$script" 2>&1 | tail -2 | head -1)
    else
      script="scripts/match-bench.ts"
      out=$(env MODE=match SNAPSHOT="$snap" APIKEY_ID="$APIKEY_ID" USE_IMAGES=false \
        LLM_PROVIDER="$provider" "${model_var}=${model}" \
        LLM_MAX_CONCURRENT="$concur" VERIFY_CHUNK="$chunk" \
        node --env-file=.env --import tsx "$script" 2>&1 | tail -2 | head -1)
    fi
    # Parse "TOTAL XXXXms  match=N reject=M"
    wall=$(echo "$out" | grep -oE "TOTAL [0-9]+" | grep -oE "[0-9]+")
    matches=$(echo "$out" | grep -oE "match=[0-9]+" | grep -oE "[0-9]+")
    echo -e "${dataset}\t${model}\t${chunk}\t${strategy}\t${r}\t${wall}\t${matches}" >> "$RESULTS_FILE"
    echo "  [$label r$r] wall=${wall}ms match=${matches}"
  done
}

run_dataset() {
  local dataset="$1" snap="$2" seed="$3"
  echo "═══════════════════════════════════════════════════════"
  echo " DATASET: $dataset"
  echo "═══════════════════════════════════════════════════════"
  for model_combo in \
    "google GOOGLE_MODEL gemini-3.1-flash-lite-preview" \
    "google GOOGLE_MODEL gemini-2.5-flash-lite" \
    "google GOOGLE_MODEL gemini-2.5-flash" \
    "openai OPENAI_MODEL gpt-5.4-mini"; do
    read -r prov mvar mname <<< "$model_combo"
    for chunk in 1 5 10; do
      for strategy in single ensemble2; do
        local label="${mname:0:18}/c${chunk}/${strategy}"
        echo "── ${label} ──"
        run_config "$label" "$dataset" "$snap" "$seed" "$mvar" "$mname" "$prov" "$chunk" "$strategy"
      done
    done
  done
}

run_dataset casio "$CASIO_SNAP" "$CASIO_SEED"
run_dataset jordan "$JORDAN_SNAP" "$JORDAN_SEED"

echo ""
echo "Raw results saved to $RESULTS_FILE"
echo "Run match-score across all match-*.json to compute F1, then aggregate."
