/**
 * Delegate-mode prompt builder. When a caller asks for `mode:
 * "delegate"`, we don't run any LLM — we hand back a system + user
 * payload that the caller can feed to *its* model (Claude Opus inside
 * Claude Code, GPT inside Cursor, etc.). The host materialises the
 * `MatchResponse` locally.
 *
 * The hosted matcher uses two passes (cheap triage + deep verify)
 * because we run smaller / cheaper models there. Strong host models
 * don't need the cost optimisation, so delegate mode collapses both
 * passes into a single system prompt that's strict-by-default. This
 * also keeps the caller from needing to re-fetch ItemDetails — title
 * + condition + price + thumbnail are enough for almost every SKU
 * the strict rules care about.
 */

import { randomUUID } from "node:crypto";
import type { MatchDelegateContent, MatchDelegateResponse, MatchOptions } from "@flipagent/types";
import type { ItemSummary } from "@flipagent/types/ebay/buy";

const DELEGATE_SYSTEM = `You are filtering an eBay search-result POOL against a CANDIDATE listing.

For each pool item, decide whether a buyer expecting the candidate would accept this item as a substitute.

PRIMARY SIGNALS — treat as authoritative:
- Brand
- Model / reference / SKU / part number printed on the product itself (e.g. "YA1264153")
- Condition tier — eBay tiers price separately. New, Refurbished, Used / Pre-Owned, and For Parts are NOT interchangeable.
- Variant when product-defining: colour, size, capacity, edition, year, generation, material (e.g. silver dial vs black dial, 36mm vs 38mm)

REJECT (return "bucket":"reject") when an objective product-defining attribute differs:
- Different reference number in the title
- Different colour / size / material / year stated in both titles
- Different condition tier
- Genuinely different model line

ACCEPT (return "bucket":"match") when title + reference + condition all line up. Borderline cases that don't fail an objective rule should be accepted — we'd rather over-include and let downstream stats trim outliers than over-reject and starve the comparable pool.

NOISE — IGNORE these. Sellers fill aspects inconsistently:
- Country of Origin discrepancies
- UPC fields saying "Does not apply" / "N/A" / missing
- Department / gender labels (Unisex vs Men vs Women) when the model is the same product
- "Type" or "Style" aspects that contradict the title — title wins
- Marketing copy / wording / photo angle differences

Decide each item independently. Return ONLY a JSON array, one entry per pool item, in input order:
[{"i":0,"bucket":"match","reason":"one short sentence"},{"i":1,"bucket":"reject","reason":"..."}]
Each "reason" ≤ 16 words.`;

const OUTPUT_SCHEMA = {
	type: "array",
	items: {
		type: "object",
		required: ["i", "bucket", "reason"],
		properties: {
			i: { type: "integer", minimum: 0 },
			bucket: { type: "string", enum: ["match", "reject"] },
			reason: { type: "string", maxLength: 200 },
		},
	},
} as const;

const OUTPUT_HINT = `Return ONLY a JSON array (no prose, no code fences) where each entry is {"i":<pool index>, "bucket":"match"|"reject", "reason":"<one short sentence>"}. Indices match the [N] markers on the pool items below.`;

function summarise(item: ItemSummary): string {
	const parts: string[] = [];
	parts.push(`title: ${item.title}`);
	if (item.condition) parts.push(`condition: ${item.condition}`);
	const price = item.lastSoldPrice?.value ?? item.price?.value;
	if (price) parts.push(`price: $${price}`);
	return parts.join(" | ");
}

export function buildDelegatePrompt(
	candidate: ItemSummary,
	pool: ReadonlyArray<ItemSummary>,
	options: MatchOptions,
): MatchDelegateResponse {
	const useImages = options.useImages ?? true;
	const user: MatchDelegateContent[] = [];

	if (useImages && candidate.image?.imageUrl) {
		user.push({ type: "text", text: "CANDIDATE IMAGE:" });
		user.push({ type: "image", imageUrl: candidate.image.imageUrl });
	}
	user.push({ type: "text", text: `CANDIDATE\n${summarise(candidate)}` });

	user.push({ type: "text", text: `\nPOOL (${pool.length} items):` });
	const itemIds: string[] = [];
	for (let i = 0; i < pool.length; i++) {
		const item = pool[i];
		if (!item) continue;
		itemIds.push(item.itemId);
		if (useImages && item.image?.imageUrl) {
			user.push({ type: "text", text: `[${i}] image:` });
			user.push({ type: "image", imageUrl: item.image.imageUrl });
		}
		user.push({ type: "text", text: `[${i}] ${summarise(item)}` });
	}

	user.push({ type: "text", text: `\n${OUTPUT_HINT}` });

	return {
		mode: "delegate",
		system: DELEGATE_SYSTEM,
		user,
		itemIds,
		outputSchema: OUTPUT_SCHEMA,
		outputHint: OUTPUT_HINT,
		traceId: randomUUID(),
	};
}
