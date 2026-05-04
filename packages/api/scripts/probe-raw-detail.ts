/**
 * Probe the RAW EbayItemDetail (before normalize) to see what the parser
 * actually extracted, vs the normalized ItemDetail. Useful when the
 * normalized output is missing data we expected the parser to find.
 */
import { canonicaliseConditionText, parseEbayDetailHtml, resolveConditionId } from "@flipagent/ebay-scraper";
import { fetchHtmlViaScraperApi } from "../src/services/ebay/scrape/scraper-api/index.js";
import { ebayDetailToBrowse } from "../src/services/ebay/scrape/normalize.js";

const ITEMS = (process.env.ITEMS ?? "").split(",").filter(Boolean);
if (ITEMS.length === 0) throw new Error("ITEMS env required");

import { JSDOM } from "jsdom";
const domFactory = (html: string) => new JSDOM(html).window.document;

async function main(): Promise<void> {
	for (const id of ITEMS) {
		const url = `https://www.ebay.com/itm/${encodeURIComponent(id)}`;
		const html = await fetchHtmlViaScraperApi(url);
		const raw = parseEbayDetailHtml(html, url, domFactory);
		console.log(`════════════════════════════════════════════════════════════════════════════════`);
		console.log(`itemId: ${id}`);
		console.log(`────────────────────────────────────────────────────────────────────────────────`);
		console.log(`  raw.condition:           ${JSON.stringify(raw.condition)}`);
		console.log(`  canonicalise(...):       ${JSON.stringify(canonicaliseConditionText(raw.condition))}`);
		console.log(`  resolveConditionId(...): ${JSON.stringify(resolveConditionId(canonicaliseConditionText(raw.condition)))}`);
		console.log(`  raw.aspects (count):     ${raw.aspects.length}`);
		console.log(`  raw.aspects:             ${JSON.stringify(raw.aspects.slice(0, 5))}`);
		console.log(`  raw.conditionDescriptors:${JSON.stringify(raw.conditionDescriptors)}`);
		const norm = ebayDetailToBrowse(raw);
		console.log(`  normalized.condition:    ${JSON.stringify(norm?.condition)}`);
		console.log(`  normalized.conditionId:  ${JSON.stringify(norm?.conditionId)}`);
		console.log(`  normalized.localizedAspects: ${JSON.stringify(norm?.localizedAspects?.slice(0, 5))}`);
		console.log(`  normalized.conditionDescriptors: ${JSON.stringify(norm?.conditionDescriptors)}`);
		console.log("");
	}
	process.exit(0);
}
main().catch((err) => { console.error(err); process.exit(2); });
