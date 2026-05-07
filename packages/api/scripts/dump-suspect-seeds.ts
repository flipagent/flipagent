/**
 * Dump full match+reject corpus for the 18 seeds where the LLM has fired
 * "suspect price (likely replica)" at least once. Output: a JSON file
 * suitable for hand-labeling (legit | suspicious | wrong_product) and
 * downstream strategy benchmarking.
 *
 * Read-only.
 *
 * Usage:
 *   node --env-file=.env --import tsx scripts/dump-suspect-seeds.ts > /tmp/suspect-seeds.json
 */

import { writeFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { listingObservations, matchHistory } from "../src/db/schema.js";

interface LabeledRow {
	candidate_id: string;
	seed_title: string;
	seed_price: number;
	seed_cond: string | null;
	item_id: string;
	llm_decision: "match" | "reject";
	llm_reason: string;
	llm_category: string | null;
	item_title: string;
	item_price: number;
	item_cond: string | null;
	seller_fb: number | null;
	seller_pct: string | null;
	ratio: number;
	// Reserved for hand-labeling:
	truth?: "legit" | "suspicious" | "wrong_product" | null;
	notes?: string;
}

function legacyOf(compositeId: string): string {
	return compositeId.split("|")[1] ?? compositeId;
}

async function latestSnapshot(legacyId: string): Promise<{
	title: string | null;
	priceCents: number | null;
	shippingCents: number | null;
	condition: string | null;
	sellerFeedbackScore: number | null;
	sellerFeedbackPercentage: string | null;
} | null> {
	const rows = await db
		.select({
			title: listingObservations.title,
			priceCents: listingObservations.priceCents,
			shippingCents: listingObservations.shippingCents,
			condition: listingObservations.condition,
			sellerFeedbackScore: listingObservations.sellerFeedbackScore,
			sellerFeedbackPercentage: listingObservations.sellerFeedbackPercentage,
		})
		.from(listingObservations)
		.where(eq(listingObservations.legacyItemId, legacyId))
		.orderBy(sql`observed_at DESC`)
		.limit(1);
	return rows[0] ?? null;
}

async function main(): Promise<void> {
	const seedRows = await db
		.selectDistinct({ candidateId: matchHistory.candidateId })
		.from(matchHistory)
		.where(sql`${matchHistory.decision}='reject' AND ${matchHistory.reason}='suspect price (likely replica)'`);
	const seeds = seedRows.map((r) => ({ candidate_id: r.candidateId }));

	const out: LabeledRow[] = [];

	for (const s of seeds) {
		const seedSnap = await latestSnapshot(legacyOf(s.candidate_id));
		if (!seedSnap || !seedSnap.priceCents) continue;
		const seedPrice = (seedSnap.priceCents + (seedSnap.shippingCents ?? 0)) / 100;

		const decisions = await db
			.select({
				itemId: matchHistory.itemId,
				decision: matchHistory.decision,
				reason: matchHistory.reason,
				category: matchHistory.category,
			})
			.from(matchHistory)
			.where(eq(matchHistory.candidateId, s.candidate_id));

		// Dedupe by itemId — match_history may have multiple rows per pair.
		const byItem = new Map<string, (typeof decisions)[number]>();
		for (const d of decisions) {
			const cur = byItem.get(d.itemId);
			if (!cur) byItem.set(d.itemId, d);
		}

		for (const d of byItem.values()) {
			const itemSnap = await latestSnapshot(legacyOf(d.itemId));
			if (!itemSnap || !itemSnap.priceCents) continue;
			const itemPrice = (itemSnap.priceCents + (itemSnap.shippingCents ?? 0)) / 100;

			out.push({
				candidate_id: s.candidate_id,
				seed_title: seedSnap.title ?? "",
				seed_price: seedPrice,
				seed_cond: seedSnap.condition,
				item_id: d.itemId,
				llm_decision: d.decision as "match" | "reject",
				llm_reason: d.reason ?? "",
				llm_category: d.category,
				item_title: itemSnap.title ?? "",
				item_price: itemPrice,
				item_cond: itemSnap.condition,
				seller_fb: itemSnap.sellerFeedbackScore,
				seller_pct: itemSnap.sellerFeedbackPercentage,
				ratio: Math.round((itemPrice / Math.max(seedPrice, 1)) * 1000) / 1000,
			});
		}
	}

	writeFileSync("/tmp/suspect-seeds.json", JSON.stringify(out, null, 2));
	console.log(`wrote ${out.length} rows across ${seeds.length} seeds`);
	process.exit(0);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
