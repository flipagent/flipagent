#!/usr/bin/env bash
# Scaffolding to add a new labeled dataset to the regression suite.
#
# Usage:
#   bash scripts/add-dataset.sh <DATASET_ID> <SEED_ITEM_ID> "<CATEGORY>" "<CHALLENGES>"
#
# Example:
#   bash scripts/add-dataset.sh pokemon-charizard-psa10 'v1|XXXXXXXXX|0' "card" \
#     "PSA grade discrimination, 1st Edition vs Unlimited"
#
# This will:
#   1. Snapshot the seed (writes scripts/.bench-out/snap-<stamp>.json)
#   2. Print the pool with all titles for human labeling
#   3. Open a label template at scripts/.bench-out/labels-<id>.v2.json
#      with each item ready to be labeled match/reject
#   4. Print instructions to add the dataset entry to datasets.json

set -u

if [ $# -lt 4 ]; then
  echo "Usage: bash scripts/add-dataset.sh <DATASET_ID> <SEED_ITEM_ID> \"<CATEGORY>\" \"<CHALLENGES>\""
  exit 1
fi

DATASET_ID="$1"
SEED_ITEM="$2"
CATEGORY="$3"
CHALLENGES="$4"
APIKEY_ID="${APIKEY_ID:-d3b36b4f-4e4d-41a5-94e6-1b57f3d7261d}"

echo "[add-dataset] $DATASET_ID seed=$SEED_ITEM"
echo

# Step 1: snapshot
SNAP_FILE=$(MODE=snapshot ITEM_ID="$SEED_ITEM" APIKEY_ID="$APIKEY_ID" \
  node --env-file=.env --import tsx scripts/match-bench.ts 2>&1 | grep '\[snap\] →' | awk '{print $3}')
echo "[add-dataset] snapshot: $SNAP_FILE"

# Step 2: scaffold label file
LABEL_FILE="scripts/.bench-out/labels-${DATASET_ID}.v2.json"
node -e "
const fs = require('fs');
const snap = JSON.parse(fs.readFileSync('$SNAP_FILE','utf8'));
const items = {};
const seen = new Set();
for (const it of snap.soldRaw) { if (!seen.has(it.itemId)) { seen.add(it.itemId); items[it.itemId] = { label: 'TODO', note: it.title.slice(0,80), confidence: 'high', audited: false, auditNote: null }; } }
for (const it of snap.activeRaw) { if (!seen.has(it.itemId)) { seen.add(it.itemId); items[it.itemId] = { label: 'TODO', note: it.title.slice(0,80), confidence: 'high', audited: false, auditNote: null }; } }
const v2 = {
  _meta: {
    datasetId: '$DATASET_ID',
    version: 2,
    snapshot: '$SNAP_FILE',
    seed: { itemId: '$SEED_ITEM', title: snap.seed.title },
    rule: '<<< FILL IN — what defines a match (e.g. exact reference, size, capacity, color) >>>',
    challenges: '$CHALLENGES',
    auditHistory: [{ date: new Date().toISOString().slice(0,10), action: 'scaffolded — items labeled TODO; replace with match|reject', auditor: 'add-dataset.sh' }],
    counts: { total: Object.keys(items).length, match: 0, reject: 0, audited: 0, borderline: 0 },
  },
  items,
};
fs.writeFileSync('$LABEL_FILE', JSON.stringify(v2, null, 2));
console.log('[add-dataset] label scaffold:', '$LABEL_FILE', '(' + Object.keys(items).length + ' items, all label=TODO)');
"

# Step 3: print pool for human review
echo
echo "[add-dataset] === POOL ==="
node -e "
const snap = JSON.parse(require('fs').readFileSync('$SNAP_FILE','utf8'));
console.log('SEED:', snap.seed.title);
console.log();
const dump = (label, arr) => { console.log('=== '+label+' ==='); arr.forEach((s,i) => { const p = s.lastSoldPrice?.value || s.price?.value || '?'; console.log(\`\${label[0]}[\${String(i).padStart(2)}] \$\${String(p).padEnd(8)} \${s.title}\`); }); };
dump('SOLD', snap.soldRaw);
console.log();
dump('ACTIVE', snap.activeRaw);
"

echo
echo "[add-dataset] === NEXT STEPS ==="
echo "1. Edit $LABEL_FILE — replace each item's 'label':'TODO' with match|reject"
echo "   The 'note' field already shows the title prefix; refine as you decide."
echo "   Update _meta.rule with your labeling rule."
echo "2. Add this entry to scripts/.bench-out/datasets.json:"
cat <<EOF
   {
     "id": "$DATASET_ID",
     "category": "$CATEGORY",
     "snapshot": "$SNAP_FILE",
     "labels": "$LABEL_FILE",
     "seed": "$SEED_ITEM",
     "challenges": "$CHALLENGES"
   }
EOF
echo "3. Run audit to verify your labels vs model:"
echo "   DATASET=$DATASET_ID REPS=3 LLM_PROVIDER=google GOOGLE_MODEL=gemini-3.1-flash-lite-preview \\"
echo "     node --env-file=.env --import tsx scripts/audit-labels.ts"
echo "4. Resolve disagreements via scripts/.bench-out/audit-decisions-$DATASET_ID.json + apply-audit-decisions.ts"
echo "5. Verify regression passes:"
echo "   node --env-file=.env --import tsx scripts/match-regression.ts"
