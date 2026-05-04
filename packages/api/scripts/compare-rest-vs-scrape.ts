/**
 * Field-by-field comparison of ItemDetail returned by REST vs scrape for
 * the same itemId. Prints values side by side and marks differences.
 *
 * For each item, calls both transports against eBay and walks the union
 * of keys present in either response.
 *
 * Usage:
 *   ITEMS="187760409559,127815598917,205818705843" \
 *     node --env-file=.env --import tsx scripts/compare-rest-vs-scrape.ts
 */
import { eq } from "drizzle-orm";
import type { ItemDetail } from "@flipagent/types/ebay";
import { db } from "../src/db/client.js";
import { apiKeys } from "../src/db/schema.js";
import { scrapeItemDetail } from "../src/services/ebay/scrape/client.js";
import { fetchItemDetailRest } from "../src/services/items/rest.js";

const ITEMS = (process.env.ITEMS ?? "").split(",").filter(Boolean);
if (ITEMS.length === 0) throw new Error("ITEMS env required");
const APIKEY_ID = process.env.APIKEY_ID ?? "d3b36b4f-4e4d-41a5-94e6-1b57f3d7261d";

// Fields where REST/scrape differing values are expected and don't reflect
// transport quality (timestamps from server clock; live-state fields like
// bidCount/watchCount that move continuously; transport-specific aux that
// downstream code doesn't read).
const IGNORE_KEYS = new Set([
	"itemHref",
	"thumbnailImages",
	"warnings",
	"itemAffiliateWebUrl",
	"sellerItemRevision",
	"adultOnly",
	"availableCoupons",
	"primaryProductReviewRating",
	"taxes",
	"buyingOptions", // REST omits when ENDED; scrape derives from time-left
	"watchCount",     // live-state, drifts between calls
	"bidCount",       // live-state
	"currentBidPrice",
	"timeLeft",
	"estimatedAvailabilities",
	"itemCreationDate",
	"itemEndDate",
]);

function clip(v: unknown, max = 100): string {
	if (v === undefined) return "(undef)";
	if (v === null) return "null";
	if (typeof v === "string") return v.length > max ? `${v.slice(0, max)}…` : v;
	if (Array.isArray(v)) return `[${v.length}] ${JSON.stringify(v).slice(0, max)}${JSON.stringify(v).length > max ? "…" : ""}`;
	if (typeof v === "object") {
		const s = JSON.stringify(v);
		return s.length > max ? `${s.slice(0, max)}…` : s;
	}
	return String(v);
}

function summariseEqual(rest: unknown, scrape: unknown): "EQUAL" | "REST_ONLY" | "SCRAPE_ONLY" | "DIFFER" {
	const rEmpty = rest === undefined || rest === null || (Array.isArray(rest) && rest.length === 0);
	const sEmpty = scrape === undefined || scrape === null || (Array.isArray(scrape) && scrape.length === 0);
	if (rEmpty && sEmpty) return "EQUAL";
	if (rEmpty && !sEmpty) return "SCRAPE_ONLY";
	if (!rEmpty && sEmpty) return "REST_ONLY";
	if (typeof rest === "object" || typeof scrape === "object") {
		return JSON.stringify(rest) === JSON.stringify(scrape) ? "EQUAL" : "DIFFER";
	}
	return rest === scrape ? "EQUAL" : "DIFFER";
}

async function main(): Promise<void> {
	const rows = await db.select().from(apiKeys).where(eq(apiKeys.id, APIKEY_ID));
	const apiKey = rows[0];
	if (!apiKey) throw new Error("apiKey not found");

	for (const id of ITEMS) {
		console.log("════════════════════════════════════════════════════════════════════════════════");
		console.log(`itemId: ${id}`);
		console.log("════════════════════════════════════════════════════════════════════════════════");

		const [rest, scrape] = await Promise.all([
			fetchItemDetailRest(id, { apiKey }).catch((err) => {
				console.log(`[REST]   error: ${err.message}`);
				return null;
			}),
			scrapeItemDetail(`v1|${id}|0`).catch((err) => {
				console.log(`[SCRAPE] error: ${err.message}`);
				return null;
			}),
		]);

		if (!rest || !scrape) {
			console.log(rest ? "  scrape returned null" : "  REST returned null");
			continue;
		}

		const allKeys = new Set<string>([...Object.keys(rest), ...Object.keys(scrape as ItemDetail)]);
		const filtered = [...allKeys].filter((k) => !IGNORE_KEYS.has(k)).sort();

		const buckets: Record<string, string[]> = { EQUAL: [], REST_ONLY: [], SCRAPE_ONLY: [], DIFFER: [] };
		for (const key of filtered) {
			const r = (rest as Record<string, unknown>)[key];
			const s = (scrape as unknown as Record<string, unknown>)[key];
			const verdict = summariseEqual(r, s);
			buckets[verdict]!.push(key);
		}

		console.log(`\n  ✅ EQUAL (${buckets.EQUAL!.length}): ${buckets.EQUAL!.join(", ")}`);
		console.log(`\n  🟡 REST_ONLY (${buckets.REST_ONLY!.length}):`);
		for (const k of buckets.REST_ONLY!) {
			console.log(`     ${k.padEnd(28)} REST=${clip((rest as Record<string, unknown>)[k])}`);
		}
		console.log(`\n  🟣 SCRAPE_ONLY (${buckets.SCRAPE_ONLY!.length}):`);
		for (const k of buckets.SCRAPE_ONLY!) {
			console.log(`     ${k.padEnd(28)} SCRAPE=${clip((scrape as unknown as Record<string, unknown>)[k])}`);
		}
		console.log(`\n  🔴 DIFFER (${buckets.DIFFER!.length}):`);
		for (const k of buckets.DIFFER!) {
			console.log(`     ${k}`);
			console.log(`        REST:   ${clip((rest as Record<string, unknown>)[k], 200)}`);
			console.log(`        SCRAPE: ${clip((scrape as unknown as Record<string, unknown>)[k], 200)}`);
		}
		console.log("");
	}
	process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(2); });
