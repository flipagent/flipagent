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
  local model="$1" dataset="$2" snap="$3" seed="$4"
  for r in $(seq 1 $REPS); do
    flush "$seed"
    out=$(env OPENAI_REASONING_EFFORT=low MODE=match SNAPSHOT="$snap" APIKEY_ID="$APIKEY_ID" USE_IMAGES=false \
      LLM_PROVIDER=openai OPENAI_MODEL="$model" \
      LLM_MAX_CONCURRENT=16 VERIFY_CHUNK=10 \
      node --env-file=.env --import tsx scripts/match-bench.ts 2>&1 | tail -2 | head -1)
    wall=$(echo "$out" | grep -oE "TOTAL [0-9]+" | grep -oE "[0-9]+")
    matches=$(echo "$out" | grep -oE "match=[0-9]+" | grep -oE "[0-9]+")
    echo "  [$model/$dataset r$r] wall=${wall}ms match=${matches}"
  done
}

for ds in "casio $CASIO_SNAP $CASIO_SEED" "jordan $JORDAN_SNAP $JORDAN_SEED"; do
  read -r dataset snap seed <<< "$ds"
  echo "═══ $dataset ═══"
  for model in gpt-5.4 gpt-5.5; do
    echo "── $model ──"
    run "$model" "$dataset" "$snap" "$seed"
  done
done
