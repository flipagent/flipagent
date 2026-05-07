/**
 * For every match_history reject with reason="suspect price (likely replica)",
 * reconstruct the inputs to quant's assessRisk() from listing_observations
 * (seed snapshot, item snapshot, sibling matched comps as the legit pool),
 * then compute P_fraud and ask: "what would the proposed split decide here?"
 *
 * Read-only. No writes.
 *
 * Usage:
 *   node --env-file=.env --import tsx scripts/audit-suspect-price-rejects.ts
 */

import { eq, sql } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { listingObservations, matchHistory } from "../src/db/schema.js";
import { legitMarketReference } from "../src/services/evaluate/adapter.js";
import { assessRisk } from "../src/services/quant/risk.js";

interface ItemSnap {
	legacyItemId: string;
	title: string | null;
	priceCents: number | null;
	shippingCents: number | null;
	sellerFeedbackScore: number | null;
	sellerFeedbackPercentage: string | null;
}

function legacyOf(compositeId: string): string {
	const parts = compositeId.split("|");
	return parts[1] ?? compositeId;
}

async function latestSnapshot(legacyId: string): Promise<ItemSnap | null> {
	const rows = await db
		.select({
			legacyItemId: listingObservations.legacyItemId,
			title: listingObservations.title,
			priceCents: listingObservations.priceCents,
			shippingCents: listingObservations.shippingCents,
			sellerFeedbackScore: listingObservations.sellerFeedbackScore,
			sellerFeedbackPercentage: listingObservations.sellerFeedbackPercentage,
		})
		.from(listingObservations)
		.where(eq(listingObservations.legacyItemId, legacyId))
		.orderBy(sql`observed_at DESC`)
		.limit(1);
	return rows[0] ?? null;
}

async function siblingMatchedItemIds(candidateId: string): Promise<string[]> {
	const rows = await db
		.select({ itemId: matchHistory.itemId })
		.from(matchHistory)
		.where(sql`${matchHistory.candidateId}=${candidateId} AND ${matchHistory.decision}='match'`);
	return rows.map((r) => r.itemId);
}

function snapToBrowseShape(snap: ItemSnap): {
	itemId: string;
	price?: { value: string; currency: string };
	seller?: { feedbackScore?: number; feedbackPercentage?: string };
} {
	return {
		itemId: snap.legacyItemId,
		price: snap.priceCents != null ? { value: (snap.priceCents / 100).toFixed(2), currency: "USD" } : undefined,
		seller: {
			feedbackScore: snap.sellerFeedbackScore ?? undefined,
			feedbackPercentage: snap.sellerFeedbackPercentage ?? undefined,
		},
	};
}

async function main(): Promise<void> {
	const rejects = await db
		.select({
			candidateId: matchHistory.candidateId,
			itemId: matchHistory.itemId,
		})
		.from(matchHistory)
		.where(
			sql`${matchHistory.decision}='reject' AND ${matchHistory.reason}='suspect price (likely replica)'`,
		);

	console.log(`# Auditing ${rejects.length} 'suspect price' rejects across distinct seeds`);
	console.log();

	type Row = {
		seedTitle: string;
		seedPrice: number;
		itemTitle: string;
		itemPrice: number;
		ratio: number;
		fb: number | null;
		pct: string | null;
		nLegit: number;
		medianRef: number | null;
		stdRef: number | null;
		pFraud: number | null;
	};
	const rows: Row[] = [];

	for (const r of rejects) {
		const seedSnap = await latestSnapshot(legacyOf(r.candidateId));
		const itemSnap = await latestSnapshot(legacyOf(r.itemId));
		if (!seedSnap || !itemSnap || !seedSnap.priceCents || !itemSnap.priceCents) continue;

		// Build legit market reference from sibling matched comps for this seed.
		const matchedIds = await siblingMatchedItemIds(r.candidateId);
		const compSnaps: ItemSnap[] = [];
		for (const mid of matchedIds) {
			const s = await latestSnapshot(legacyOf(mid));
			if (s && s.priceCents) compSnaps.push(s);
		}
		const browseShape = compSnaps.map(snapToBrowseShape) as Parameters<typeof legitMarketReference>[0];
		const ref = legitMarketReference(browseShape);

		const buyPriceCents = itemSnap.priceCents + (itemSnap.shippingCents ?? 0);
		const seedPriceCents = seedSnap.priceCents + (seedSnap.shippingCents ?? 0);

		// We don't store returns/days-to-sell for the comp; pFraud only depends on
		// seller feedback + market ref + buy price. Pass placeholders for the rest;
		// they only affect maxLoss/cycleDays which we ignore here.
		const risk = assessRisk({
			sellerFeedbackScore: itemSnap.sellerFeedbackScore ?? undefined,
			sellerFeedbackPercent: itemSnap.sellerFeedbackPercentage
				? Number.parseFloat(itemSnap.sellerFeedbackPercentage)
				: undefined,
			buyPriceCents,
			acceptsReturns: false,
			expectedDaysToSell: 30,
			marketMedianCents: ref?.medianCents,
			marketStdDevCents: ref?.stdDevCents,
		});

		rows.push({
			seedTitle: (seedSnap.title ?? "").slice(0, 70),
			seedPrice: seedPriceCents / 100,
			itemTitle: (itemSnap.title ?? "").slice(0, 70),
			itemPrice: buyPriceCents / 100,
			ratio: buyPriceCents / Math.max(seedPriceCents, 1),
			fb: itemSnap.sellerFeedbackScore,
			pct: itemSnap.sellerFeedbackPercentage,
			nLegit: compSnaps.length,
			medianRef: ref?.medianCents ? Math.round(ref.medianCents / 100) : null,
			stdRef: ref?.stdDevCents ? Math.round(ref.stdDevCents / 100) : null,
			pFraud: risk.P_fraud,
		});
	}

	rows.sort((a, b) => (a.pFraud ?? 0) - (b.pFraud ?? 0));

	console.log("Per-row P_fraud (sorted ascending):");
	console.log(
		[
			"P_fraud",
			"r=item/seed",
			"fb",
			"pct%",
			"medRef",
			"std",
			"item$",
			"seed$",
			"item title",
		].join("\t"),
	);
	for (const r of rows) {
		console.log(
			[
				(r.pFraud ?? 0).toFixed(3),
				r.ratio.toFixed(2),
				r.fb ?? "-",
				r.pct ?? "-",
				r.medianRef ?? "-",
				r.stdRef ?? "-",
				r.itemPrice.toFixed(0),
				r.seedPrice.toFixed(0),
				r.itemTitle,
			].join("\t"),
		);
	}

	// Threshold sweep — what fraction would each cutoff classify as flagged?
	console.log();
	console.log("Threshold sweep (rows that WOULD flip to 'match' bucket below cutoff):");
	for (const c of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.85]) {
		const below = rows.filter((r) => (r.pFraud ?? 0) < c).length;
		const above = rows.length - below;
		console.log(`  cutoff=${c.toFixed(2)}  match=${below}  flagged=${above}`);
	}

	// Buckets by P_fraud
	console.log();
	console.log("Distribution buckets:");
	const buckets = [
		{ label: "0.00–0.10 (clearly safe)", lo: 0, hi: 0.1 },
		{ label: "0.10–0.30 (probably safe)", lo: 0.1, hi: 0.3 },
		{ label: "0.30–0.50 (uncertain)", lo: 0.3, hi: 0.5 },
		{ label: "0.50–0.70 (probably scam)", lo: 0.5, hi: 0.7 },
		{ label: "0.70–0.85 (clearly scam)", lo: 0.7, hi: 0.85 + 1e-9 },
	];
	for (const b of buckets) {
		const n = rows.filter((r) => (r.pFraud ?? 0) >= b.lo && (r.pFraud ?? 0) < b.hi).length;
		console.log(`  ${b.label}: ${n}`);
	}

	process.exit(0);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
