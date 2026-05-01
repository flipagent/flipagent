/**
 * One-shot: pull real listings + sold-pool data for every QUICKSTART
 * preset shown to logged-out visitors in the landing-hero playground,
 * download each image, and emit a single `fixtures.json` blob ready to
 * paste into `apps/docs/src/components/playground/mockData.ts`.
 *
 * Four presets:
 *   discover/watches        q="watch" cat=31387 priceMax=300
 *   discover/charizard      q="charizard 1st edition" cat=183454
 *   evaluate/406338886641   "Gucci YA1264153 watch"
 *   evaluate/358471670268   "Travis Scott AJ1 Mocha (sz 11)"
 *
 * Outputs:
 *   /tmp/flipagent-mocks/fixtures.json
 *   apps/docs/public/demo/<itemId>.jpg     (one per unique listing)
 *
 * Run:
 *   npm --workspace @flipagent/api exec -- tsx src/scripts/fetch-quickstart-mocks.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config as _config } from "../config.js";
import { scrapeItemDetail, scrapeSearch } from "../services/ebay/scrape/client.js";

void _config;

const OUT_DIR = "/tmp/flipagent-mocks";
const PUBLIC_DEMO = "/Users/jinho/Projects/flipagent/apps/docs/public/demo";

interface DiscoverPreset {
	key: string;
	q: string;
	categoryId?: string;
	priceMin?: number;
	priceMax?: number;
	conditionIds?: string[];
}

interface EvaluatePreset {
	key: string;
	itemId: string;
	keyword: string;
}

const DISCOVER_PRESETS: DiscoverPreset[] = [
	{ key: "watches", q: "watch", categoryId: "31387", priceMax: 300, conditionIds: ["3000"] },
	{ key: "charizard", q: "charizard 1st edition", categoryId: "183454", conditionIds: ["3000"] },
];

const EVALUATE_PRESETS: EvaluatePreset[] = [
	{ key: "gucci-watch", itemId: "v1|406338886641|0", keyword: "Gucci YA1264153" },
	{ key: "aj1-mocha", itemId: "v1|358471670268|0", keyword: "Travis Scott Air Jordan 1 Mocha" },
];

const TARGET_ACTIVE_PER_PRESET = 6;
const TARGET_SOLD_PER_PRESET = 30;

async function downloadImage(itemId: string, srcUrl: string): Promise<string | null> {
	const upgraded = srcUrl.replace(/s-l\d+\.jpg/, "s-l800.jpg");
	const slug = itemId.replace(/\W+/g, "_");
	try {
		const res = await fetch(upgraded);
		if (!res.ok) return null;
		const buf = Buffer.from(await res.arrayBuffer());
		// Skip eBay's "image not found" placeholder (≈1.3KB)
		if (buf.length < 5_000) return null;
		const mime = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "image/jpeg";
		const ext = mime.endsWith("png") ? "png" : "jpg";
		const localName = `${slug}.${ext}`;
		await writeFile(join(PUBLIC_DEMO, localName), buf);
		return `/demo/${localName}`;
	} catch {
		return null;
	}
}

async function fetchDiscoverPreset(preset: DiscoverPreset): Promise<unknown> {
	console.log(`\n[discover/${preset.key}] q=${JSON.stringify(preset.q)} cat=${preset.categoryId ?? "-"}`);

	let filter: string | undefined;
	const filterParts: string[] = [];
	if (preset.priceMin || preset.priceMax) {
		const lo = preset.priceMin ?? 0;
		const hi = preset.priceMax ?? 999999;
		filterParts.push(`price:[${lo}..${hi}],priceCurrency:USD`);
	}
	if (filterParts.length) filter = filterParts.join(",");

	const active = await scrapeSearch({
		q: preset.q,
		binOnly: true,
		conditionIds: preset.conditionIds,
		sort: "pricePlusShippingLowest",
		limit: 24,
	});
	const summaries = ("itemSummaries" in active ? active.itemSummaries : []) ?? [];

	const filtered = summaries.filter((s) => {
		if (!s.image?.imageUrl) return false;
		const cents = Math.round((Number.parseFloat(s.price?.value ?? "0") || 0) * 100);
		if (preset.priceMin && cents < preset.priceMin * 100) return false;
		if (preset.priceMax && cents > preset.priceMax * 100) return false;
		return true;
	});
	console.log(`  active: ${summaries.length} → ${filtered.length} after price/image filter`);

	const picked: Array<Record<string, unknown>> = [];
	for (const item of filtered) {
		if (picked.length >= TARGET_ACTIVE_PER_PRESET) break;
		const localUrl = await downloadImage(item.itemId, item.image!.imageUrl!);
		if (!localUrl) {
			console.log(`    - ${item.itemId} skip (image fetch failed or placeholder)`);
			continue;
		}
		picked.push({ ...item, image: { imageUrl: localUrl } });
		console.log(`    ✓ ${item.itemId} $${item.price?.value} → ${localUrl}`);
	}

	const sold = await scrapeSearch({
		q: preset.q,
		soldOnly: true,
		conditionIds: preset.conditionIds,
		limit: 200,
	});
	const allSales = ("itemSales" in sold ? sold.itemSales : []) ?? [];

	// Keep sold within the active price band (real discover clusters by
	// title similarity; this approximates by price proximity for the mock).
	const soldFiltered = allSales.filter((s) => {
		const c = Math.round((Number.parseFloat(s.lastSoldPrice?.value ?? "0") || 0) * 100);
		if (preset.priceMin && c < preset.priceMin * 100) return false;
		if (preset.priceMax && c > preset.priceMax * 100) return false;
		// If no preset bands, drop pennies + extreme luxury outliers
		if (!preset.priceMin && !preset.priceMax && (c < 500 || c > 1_000_00)) return false;
		return true;
	});
	console.log(`  sold: ${allSales.length} → ${soldFiltered.length} after price-band filter`);

	return {
		preset,
		filter,
		activeListings: picked,
		soldListings: soldFiltered.slice(0, TARGET_SOLD_PER_PRESET),
	};
}

async function fetchEvaluatePreset(preset: EvaluatePreset): Promise<unknown> {
	console.log(`\n[evaluate/${preset.key}] keyword=${JSON.stringify(preset.keyword)}`);

	// The hard-coded itemId in PlaygroundEvaluate's QUICKSTART_EXAMPLES is
	// frequently stale (eBay listings expire ~30d). Resolve by searching
	// the keyword and taking the cheapest live listing with an image — same
	// strategy a logged-in user would get on first click.
	const search = await scrapeSearch({
		q: preset.keyword,
		binOnly: true,
		conditionIds: ["3000"],
		sort: "pricePlusShippingLowest",
		limit: 12,
	});
	const candidates = (("itemSummaries" in search ? search.itemSummaries : []) ?? []).filter(
		(s) => s.image?.imageUrl && Number.parseFloat(s.price?.value ?? "0") > 0,
	);
	if (!candidates.length) {
		console.log("  ! no live listing found for keyword");
		return { preset, detail: null };
	}

	// Try up to the first 5 candidates — detail fetch is flaky for some
	// listings (privacy-mode sellers, blocked variants, etc).
	let live: (typeof candidates)[number] | null = null;
	let detail: Awaited<ReturnType<typeof scrapeItemDetail>> | null = null;
	for (const cand of candidates.slice(0, 5)) {
		console.log(`  try → ${cand.itemId} "${cand.title}" $${cand.price?.value}`);
		const got = await scrapeItemDetail(cand.itemId);
		if (got) {
			live = cand;
			detail = got;
			break;
		}
		console.log("    - detail fetch failed, trying next");
	}
	if (!live || !detail) {
		console.log("  ! all candidates failed");
		return { preset, detail: null };
	}
	console.log(`  ✓ detail "${detail.title}" $${detail.price?.value}`);

	let detailWithLocalImage: typeof detail = detail;
	const detailImage = detail.image?.imageUrl ?? live.image?.imageUrl;
	if (detailImage) {
		const localUrl = await downloadImage(live.itemId, detailImage);
		if (localUrl) {
			detailWithLocalImage = { ...detail, image: { imageUrl: localUrl } };
			console.log(`    ✓ image → ${localUrl}`);
		} else {
			console.log("    - image fetch failed");
		}
	}

	const sold = await scrapeSearch({
		q: preset.keyword,
		soldOnly: true,
		conditionIds: ["3000"],
		limit: 200,
	});
	const allSales = ("itemSales" in sold ? sold.itemSales : []) ?? [];
	// Drop only the obvious outliers (>3× resolved ask) so we keep enough
	// rows for a histogram. Real evaluate clusters by title, but these
	// are keyword sold-search dumps so size/condition variance is fine.
	const askCents = Math.round((Number.parseFloat(detail.price?.value ?? "0") || 0) * 100);
	const sales = askCents
		? allSales.filter((s) => {
				const c = Math.round((Number.parseFloat(s.lastSoldPrice?.value ?? "0") || 0) * 100);
				return c > 0 && c <= askCents * 3;
			})
		: allSales;
	console.log(`  sold: ${allSales.length} → ${sales.length} after outlier trim`);

	const active = await scrapeSearch({
		q: preset.keyword,
		binOnly: true,
		conditionIds: ["3000"],
		sort: "pricePlusShippingLowest",
		limit: 30,
	});
	const activeList = ("itemSummaries" in active ? active.itemSummaries : []) ?? [];
	console.log(`  active: ${activeList.length}`);

	return {
		preset,
		detail: detailWithLocalImage,
		soldListings: sales.slice(0, TARGET_SOLD_PER_PRESET),
		activePool: activeList.slice(0, 18),
	};
}

async function main(): Promise<void> {
	await mkdir(OUT_DIR, { recursive: true });
	await mkdir(PUBLIC_DEMO, { recursive: true });

	const discover: Record<string, unknown> = {};
	for (const preset of DISCOVER_PRESETS) {
		discover[preset.key] = await fetchDiscoverPreset(preset);
	}

	const evaluate: Record<string, unknown> = {};
	for (const preset of EVALUATE_PRESETS) {
		evaluate[preset.itemId] = await fetchEvaluatePreset(preset);
	}

	const out = { discover, evaluate, fetchedAt: new Date().toISOString() };
	const dest = join(OUT_DIR, "fixtures.json");
	await writeFile(dest, JSON.stringify(out, null, "\t"));
	console.log(`\n✓ wrote ${dest}`);
	console.log(`✓ images in ${PUBLIC_DEMO}/`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
