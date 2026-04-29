import { MatchRequest as MatchPoolInputSchema, type MatchRequest } from "@flipagent/types";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

export { MatchPoolInputSchema as matchPoolInput };

export const matchPoolDescription = `Classify each listing in a pool as the same product as the candidate or not. Calls POST /v1/match.

**When to call:** before /v1/research/summary or /v1/evaluate. Skipping this step inflates the comparable pool with similar-but-different SKUs and produces a wrong median (the Gucci YA1264153 case: a $450 mixed median collapses to $350 once true-match comparables are isolated — a 28% pricing error).

**Two execution modes:**

- \`options.mode: "hosted"\` (default) — the flipagent backend runs an LLM in two passes (pass 1 batch-triages titles + conditions + prices, pass 2 deep-verifies against full \`localizedAspects\` + images). You pay one call against your monthly quota; we eat the inference cost.

- \`options.mode: "delegate"\` — the server returns a ready-to-run prompt + JSON schema instead of running an LLM. **You** (the host agent) feed the prompt to your own model, parse the JSON array, and synthesise the \`MatchResponse\` locally. Useful when the host LLM is already strong (Claude Code, Cursor) so the inference is "free" — saves the round-trip and quota call. After classifying, optionally call \`flipagent_match_trace\` with your decisions so the flipagent calibration loop stays warm. Disable trace upload with \`FLIPAGENT_TELEMETRY=0\`.

**Two buckets returned (hosted mode):**
- \`match\` — same product, same configuration. Use directly as comparables.
- \`reject\` — different in some way. Discard. The \`reason\` field explains why.

**Delegate response shape:**
\`\`\`
{
  mode: "delegate",
  system: string,                 // system prompt
  user: [{type:"text"|"image", ...}],  // multimodal user content
  itemIds: string[],              // pool[i].itemId for index i
  outputSchema: <JSON Schema>,    // expected LLM output
  outputHint: string,             // append if your provider lacks structured output
  traceId: string                 // echo to flipagent_match_trace
}
\`\`\`

**Recommended hosted workflow:**
\`\`\`
1. const pool = await ebay_sold_search({ q })
2. const buckets = await match_pool({ candidate, pool: pool.itemSales })
3. await research_summary({ comparables: buckets.match.map(m => m.item) })
4. await evaluate_listing({ item: candidate, opts: { comparables: ... } })
\`\`\`

**Recommended delegate workflow (when YOU are a strong LLM):**
\`\`\`
1. const pool = await ebay_sold_search({ q })
2. const prompt = await match_pool({ candidate, pool: pool.itemSales, options: { mode: "delegate" } })
3. // Reason over prompt.system + prompt.user yourself, produce
   //   [{i, bucket, reason}, ...] matching prompt.outputSchema.
4. const decisions = your_verdicts.map((v) => ({ itemId: prompt.itemIds[v.i], bucket: v.bucket, reason: v.reason }))
5. await flipagent_match_trace({ traceId: prompt.traceId, candidateId: candidate.itemId, decisions, llmModel: "<your model id>" })  // skip if FLIPAGENT_TELEMETRY=0
6. const comparables = decisions.filter(d => d.bucket === "match").map(d => pool.itemSales.find(p => p.itemId === d.itemId))
7. await evaluate_listing({ item: candidate, opts: { comparables } })
\`\`\`

\`options\`:
- \`useImages: true\` (default) — inspect listing images alongside text.
- \`mode: "hosted" | "delegate"\` — see above. Default \`hosted\`.`;

export async function matchPoolExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const client = getClient(config);
	try {
		return await client.match.pool(args as unknown as MatchRequest);
	} catch (err) {
		const e = toApiCallError(err, "/v1/match");
		return { error: "match_pool_failed", status: e.status, message: e.message, url: e.url };
	}
}
