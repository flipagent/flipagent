/**
 * Probe what fields a live `/b/<slug>/<id>` (browse-layout) hydration JSON
 * carries per card — specifically whether it surfaces seller / TRP / AG
 * signals so we know if `browseLayoutCardToSummary` can populate them.
 * Compares against keyword-SRP card data.
 */

import { fetchHtmlViaScraperApi } from "../src/services/ebay/scrape/scraper-api/index.js";

// Watches category — high AG concentration (Breitling, Rolex, etc.).
const URL = "https://www.ebay.com/b/Breitling-Wristwatches/31387";

async function main(): Promise<void> {
	const html = await fetchHtmlViaScraperApi(URL);
	console.log("bytes:", html.length);

	// Extract every ListingItemCard block (top-level brackets, naive).
	const re = /\{"_type":"ListingItemCard"/g;
	const starts: number[] = [];
	let m: RegExpExecArray | null = re.exec(html);
	while (m !== null) {
		starts.push(m.index);
		m = re.exec(html);
	}
	console.log("listing item cards:", starts.length);

	// Per-card: count occurrences of seller/AG/TRP-ish keys.
	const probes = [
		"seller",
		"sellerName",
		"feedback",
		"feedbackScore",
		"feedbackPercentage",
		"positiveFeedback",
		"trustSignal",
		"trustSignals",
		"authenticity",
		"AUTHENTICITY_GUARANTEE",
		"qualifiedProgram",
		"topRated",
		"TopRated",
		"vetted",
		"badge",
		"badges",
		"trust",
		"itemEndDate",
		"endTime",
		"timeLeft",
		"bidCount",
		"currentBid",
	];
	const totals: Record<string, number> = Object.fromEntries(probes.map((p) => [p, 0]));
	for (let i = 0; i < starts.length; i++) {
		const start = starts[i] ?? 0;
		const end = starts[i + 1] ?? Math.min(start + 60_000, html.length);
		const slice = html.slice(start, end);
		for (const p of probes) {
			if (slice.includes(`"${p}"`)) {
				totals[p] = (totals[p] ?? 0) + 1;
			}
		}
	}
	console.log("key counts (per-card):");
	for (const [k, v] of Object.entries(totals)) {
		if (v > 0) console.log(`  ${k}: ${v} / ${starts.length}`);
	}

	// Dump JSON-side AG context (authorizedSeller key value).
	const authSellerIdx = html.search(/"authorizedSeller"/);
	if (authSellerIdx > 0) {
		console.log("\nauthorizedSeller JSON context:");
		console.log(html.slice(Math.max(0, authSellerIdx - 100), authSellerIdx + 600));
	}
	// JSON-side TopRated key context.
	const trIdx = html.search(/"TopRated"|"topRated"|"topRatedSeller"/);
	if (trIdx > 0) {
		console.log("\nTopRated JSON context:");
		console.log(html.slice(Math.max(0, trIdx - 100), trIdx + 600));
	}
	// Find the cards-array embedded `__search` block per card.
	const searchIdx = html.search(/"__search":/);
	if (searchIdx > 0) {
		console.log("\nfirst __search block (per card) — first 1500 chars:");
		console.log(html.slice(searchIdx, searchIdx + 1500));
	}
}

await main();
