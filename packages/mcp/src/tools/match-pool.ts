import { MatchRequest as MatchPoolInputSchema, type MatchRequest } from "@flipagent/types";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

export { MatchPoolInputSchema as matchPoolInput };

export const matchPoolDescription = `Classify each listing in a pool as the same product as the candidate or not. Calls POST /v1/match.

**When to call:** before /v1/research/thesis or /v1/evaluate. Skipping this step inflates the comp pool with similar-but-different SKUs and produces a wrong median (the Gucci YA1264153 case: a $450 mixed median collapses to $350 once true-match comps are isolated — a 28% pricing error).

**How it works:** the server runs an LLM in two passes. Pass 1 batch-triages the pool by titles + conditions + prices (with thumbnails when \`useImages\`). Pass 2 deep-verifies survivors against full \`localizedAspects\` and listing images. Strict by design: different model number, different finish, different colour, different condition, or missing accessories all become \`reject\`.

**Two buckets returned:**
- \`match\` — same product, same configuration. Use directly as comps.
- \`reject\` — different in some way. Discard. The \`reason\` field explains why.

**Recommended workflow:**
\`\`\`
1. const pool = await ebay_sold_search({ q })
2. const buckets = await match_pool({ candidate, pool: pool.itemSales })
3. await research_thesis({ comps: buckets.match.map(m => m.item) })
4. await evaluate_listing({ item: candidate, opts: { comps: ... } })
\`\`\`

\`options\`:
- \`useImages: true\` (default) — inspect listing images alongside text. Set to \`false\` for faster / cheaper runs when reference numbers are reliably in the titles.`;

export async function matchPoolExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const client = getClient(config);
	try {
		return await client.match.pool(args as unknown as MatchRequest);
	} catch (err) {
		const e = toApiCallError(err, "/v1/match");
		return { error: "match_pool_failed", status: e.status, message: e.message, url: e.url };
	}
}
