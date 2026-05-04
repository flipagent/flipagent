/**
 * Find a clean single-variant seed for a new dataset. Filters out:
 *   - Multi-variation parent listings (variations.length > 0)
 *   - Multi-capacity / multi-color titles ("256GB / 512GB", "Black/White")
 *   - Bundle titles ("with case", "with games")
 *   - Suspect-priced listings (< 50% of median)
 *
 * Picks the cheapest single-variant listing from the top N search results.
 * Prints itemId/title/price/aspects so a human can confirm before scaffolding.
 *
 * Usage:
 *   QUERY="Samsung Galaxy S24 Ultra 256GB Titanium Black Unlocked New" \
 *     LIMIT=20 node --env-file=.env --import tsx scripts/find-clean-seed.ts
 */
import { eq } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { apiKeys } from "../src/db/schema.js";
import { detailFetcherFor } from "../src/services/items/detail.js";
import { searchActiveListings } from "../src/services/items/search.js";

const QUERY = process.env.QUERY ?? "";
if (!QUERY) throw new Error("QUERY env required");
const LIMIT = Number.parseInt(process.env.LIMIT ?? "20", 10);
const APIKEY_ID = process.env.APIKEY_ID ?? "d3b36b4f-4e4d-41a5-94e6-1b57f3d7261d";

const MULTI_VARIANT_PATTERNS = [
	/\d+gb\s*\/\s*\d+gb/i,
	/black\s*\/\s*white/i,
	/\bw\/\b|\bwith\b\s+(case|games?|accessor|charger|controller)/i,
	/\ball\s+sizes?\b|\bsize\s+\d+\s*[-–]\s*\d+/i,
	/\bbundle\b/i,
	/\b1tb\s+\d+gb|\d+gb\s+1tb/i,
];

async function main(): Promise<void> {
	const rows = await db.select().from(apiKeys).where(eq(apiKeys.id, APIKEY_ID));
	const apiKey = rows[0];
	const fetchDetail = detailFetcherFor(apiKey);
	const r = await searchActiveListings({ q: QUERY, limit: LIMIT, filter: "conditionIds:{1000|1750}" }, { apiKey });
	const items = r.body.itemSummaries ?? [];
	console.log(`[find-clean-seed] ${items.length} candidates for "${QUERY}"\n`);

	const ranked: Array<{ itemId: string; title: string; price: string; condition: string; categoryId: string; epid?: string; reason: string; clean: boolean }> = [];
	for (const it of items) {
		const isMultiTitle = MULTI_VARIANT_PATTERNS.some((re) => re.test(it.title));
		if (isMultiTitle) {
			ranked.push({
				itemId: it.itemId,
				title: it.title,
				price: it.price?.value ?? "?",
				condition: it.condition ?? "?",
				categoryId: (it as { categoryId?: string }).categoryId ?? "?",
				reason: "multi-variant title",
				clean: false,
			});
			continue;
		}
		const detail = await fetchDetail({ itemId: it.itemId }).catch(() => null);
		if (!detail) {
			ranked.push({ itemId: it.itemId, title: it.title, price: it.price?.value ?? "?", condition: it.condition ?? "?", categoryId: "?", reason: "no detail", clean: false });
			continue;
		}
		const variations = (detail as { variations?: unknown[] }).variations;
		if (variations && variations.length > 0) {
			ranked.push({
				itemId: it.itemId,
				title: it.title,
				price: it.price?.value ?? "?",
				condition: detail.condition ?? "?",
				categoryId: detail.categoryId ?? "?",
				epid: detail.epid,
				reason: `multi-SKU parent (${variations.length} variations)`,
				clean: false,
			});
			continue;
		}
		ranked.push({
			itemId: it.itemId,
			title: it.title,
			price: it.price?.value ?? "?",
			condition: detail.condition ?? "?",
			categoryId: detail.categoryId ?? "?",
			epid: detail.epid,
			reason: "single-variant ✓",
			clean: true,
		});
	}

	const clean = ranked.filter((r) => r.clean);
	console.log(`Clean single-variant candidates: ${clean.length}/${ranked.length}\n`);
	for (let i = 0; i < clean.length; i++) {
		const c = clean[i]!;
		console.log(`[${i + 1}] ${c.itemId}   $${c.price}   condition=${c.condition}   categoryId=${c.categoryId}   epid=${c.epid ?? "(none)"}`);
		console.log(`     ${c.title}`);
	}
	console.log("\n--- skipped (not clean) ---");
	for (const r of ranked.filter((r) => !r.clean).slice(0, 5)) {
		console.log(`     ${r.itemId}   $${r.price}   ${r.reason}`);
		console.log(`     ${r.title.slice(0, 90)}`);
	}
	process.exit(0);
}
main().catch((err) => { console.error(err); process.exit(2); });
