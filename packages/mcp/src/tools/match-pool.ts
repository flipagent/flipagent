import { MatchRequest as MatchPoolInputSchema, type MatchRequest } from "@flipagent/types";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

export { MatchPoolInputSchema as matchPoolInput };

export const matchPoolDescription = `Bucket a pool of listings as match / borderline / reject against a candidate. Calls POST /v1/match.

**When to call:** before /v1/research/thesis or /v1/evaluate. Skipping this step inflates the comp pool with similar-but-different SKUs and produces a wrong median (the Gucci YA1264153 test case: $450 mixed median collapses to $350 once true-match comps are isolated — a 28% pricing error).

**How the score works:** IDF-weighted title-token overlap × condition-equality multiplier. Pure deterministic, no LLM call. Rare tokens (model numbers, reference codes) dominate naturally; common tokens ("watch", "men's") down-weight automatically. Generalises across categories without per-domain rules.

**Three buckets returned:**
- \`match\` — high-confidence same product. Use directly as comps.
- \`borderline\` — partial overlap. **Inspect each one yourself** (call ebay_item_detail, compare \`localizedAspects\` and \`image\` against the candidate). Keep if you're confident, drop if not.
- \`reject\` — clearly different SKU. Discard.

**Recommended workflow:**
\`\`\`
1. const pool = await ebay_sold_search({ q })            // raw 30
2. const buckets = await match_pool({ candidate, pool: pool.itemSales })
3. for (const b of buckets.borderline) {
     const detail = await ebay_item_detail({ itemId: b.item.itemId })
     // compare detail.localizedAspects + detail.image to candidate
     // keep b.item if same SKU, drop otherwise
   }
4. await research_thesis({ comps: [...buckets.match.map(m => m.item), ...kept] })
5. await evaluate_listing({ item: candidate, opts: { comps: ... } })
\`\`\`

\`options\` (all optional, defaults shown):
- \`matchThreshold: 0.7\` — score floor for \`match\` bucket
- \`borderlineThreshold: 0.4\` — anything below → \`reject\`
- \`conditionPenalty: 0.5\` — score multiplier when both sides know condition and they differ`;

export async function matchPoolExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const client = getClient(config);
	try {
		return await client.match.pool(args as unknown as MatchRequest);
	} catch (err) {
		const e = toApiCallError(err, "/v1/match");
		return { error: "match_pool_failed", status: e.status, message: e.message, url: e.url };
	}
}
