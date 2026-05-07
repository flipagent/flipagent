/**
 * Compare two SRP fetches for the same product:
 *   (A) full candidate title (= what evaluate currently does)
 *   (B) short brand+model query
 * Count seller-info presence + sponsored markers per card.
 */

import { writeFileSync } from "node:fs";
import { fetchHtmlViaScraperApi } from "../src/services/ebay/scrape/scraper-api/index.js";

const FULL = "Men's Breitling Colt Automatic A17380 Black Dial Stainless Steel 41mm Watch";
const SHORT = "Breitling Colt A17380";

function buildUrl(q: string, sold = false): string {
	const sp = sold ? "&LH_Sold=1&LH_Complete=1&_ipg=240" : "";
	return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}&LH_ItemCondition=3000%7C4000%7C5000%7C6000${sp}`;
}

function audit(html: string, label: string): void {
	const re = /<li[^>]*class="[^"]*\b(s-card|s-item)\b[^"]*"[^>]*>/g;
	const starts: number[] = [];
	let m: RegExpExecArray | null = re.exec(html);
	while (m !== null) {
		starts.push(m.index);
		m = re.exec(html);
	}
	const ends = [...starts.slice(1), html.length];
	const stats = {
		total: 0,
		sCard: 0,
		sItem: 0,
		withPositive: 0,
		withAuthenticityGuarantee: 0,
		withTopRatedPlus: 0,
	};
	for (let i = 0; i < starts.length; i++) {
		const slice = html.slice(starts[i] ?? 0, ends[i] ?? html.length);
		const text = slice.replace(/<[^>]*>/g, " ").replace(/&[#\w]+;/g, " ");
		if (/Shop on eBay/i.test(text) && /\$\d+\.\d+/.test(text) === false) continue;
		stats.total++;
		if (/^<li[^>]*\bs-card\b/.test(slice)) stats.sCard++;
		else if (/^<li[^>]*\bs-item\b/.test(slice)) stats.sItem++;
		if (/\d+(\.\d+)?%\s*positive/i.test(text)) stats.withPositive++;
		if (/Authenticity\s+Guarantee|authenticity-guarantee/i.test(slice)) stats.withAuthenticityGuarantee++;
		if (/Top Rated Plus|top-rated-plus/i.test(slice)) stats.withTopRatedPlus++;
	}
	console.log(label, stats);
}

async function main(): Promise<void> {
	const cases: Array<[string, string, boolean]> = [
		["BREITLING-ACTIVE", FULL, false],
		["BREITLING-SOLD  ", FULL, true],
		["SONY-ACTIVE     ", "Sony WH-1000XM5 Wireless Noise Canceling Headphones - Black", false],
		["SONY-SOLD       ", "Sony WH-1000XM5 Wireless Noise Canceling Headphones - Black", true],
	];
	for (const [label, q, sold] of cases) {
		const url = buildUrl(q, sold);
		console.log(`\n${label}: ${q}  ${sold ? "(sold)" : "(active)"}`);
		console.log(`  URL: ${url}`);
		const html = await fetchHtmlViaScraperApi(url);
		const slug = label.trim().toLowerCase().replace(/[^a-z]/g, "-");
		writeFileSync(`/tmp/breitling-srp-${slug}.html`, html);
		console.log(`  bytes: ${html.length}`);
		audit(html, `  audit:`);
	}
}

await main();
