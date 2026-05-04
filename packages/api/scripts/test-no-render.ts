/**
 * A/B test: Oxylabs realtime with `render: html` (no JS) vs default (JS-rendered).
 * For each test itemId:
 *   - Fetch with render off, time it
 *   - Fetch with default render, time it
 *   - Parse both via parseEbayDetailHtml
 *   - Compare extracted fields (parity check)
 *
 * Decides whether render: false saves time without losing data.
 */
import { JSDOM } from "jsdom";
import { parseEbayDetailHtml } from "@flipagent/ebay-scraper";
import { config } from "../src/config.js";

const ITEMS = (process.env.ITEMS ?? "187760409559,127815598917,406185837129,186397216258").split(",");

interface OxylabsResult { content: string; status_code: number; }
interface OxylabsResponse { results?: OxylabsResult[]; }

async function fetchOxy(url: string, opts: Record<string, unknown>): Promise<{ html: string; ms: number }> {
	const auth = Buffer.from(`${config.SCRAPER_API_USERNAME}:${config.SCRAPER_API_PASSWORD}`).toString("base64");
	const t0 = performance.now();
	const res = await fetch("https://realtime.oxylabs.io/v1/queries", {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
		body: JSON.stringify({ source: "universal", url, geo_location: "United States", ...opts }),
	});
	const ms = Math.round(performance.now() - t0);
	if (!res.ok) throw new Error(`http ${res.status}`);
	const j = (await res.json()) as OxylabsResponse;
	const r = j.results?.[0];
	if (!r) throw new Error("no result");
	return { html: r.content, ms };
}

const domFactory = (h: string) => new JSDOM(h).window.document;

async function main(): Promise<void> {
	console.log(`Comparing Oxylabs render-default vs render-off for ${ITEMS.length} items\n`);
	for (const id of ITEMS) {
		const url = `https://www.ebay.com/itm/${id}`;
		console.log(`════ ${id}`);
		try {
			const def = await fetchOxy(url, {});
			const noRender = await fetchOxy(url, { render: "html" });
			const dDef = parseEbayDetailHtml(def.html, url, domFactory);
			const dNo = parseEbayDetailHtml(noRender.html, url, domFactory);
			const sizeKbDef = (def.html.length / 1024).toFixed(0);
			const sizeKbNo = (noRender.html.length / 1024).toFixed(0);
			console.log(`  default:    ${def.ms}ms   ${sizeKbDef}KB   title="${dDef.title.slice(0, 50)}..."`);
			console.log(`  render:off  ${noRender.ms}ms   ${sizeKbNo}KB   title="${dNo.title.slice(0, 50)}..."`);
			console.log(`  speedup: ${(def.ms / noRender.ms).toFixed(2)}x`);
			// Field parity
			const fields = [
				["title", dDef.title === dNo.title],
				["condition", dDef.condition === dNo.condition],
				["epid", dDef.epid === dNo.epid],
				["mpn", dDef.mpn === dNo.mpn],
				["aspects.length", dDef.aspects.length === dNo.aspects.length],
				["variations", JSON.stringify(dDef.variations) === JSON.stringify(dNo.variations)],
				["conditionDescriptors", JSON.stringify(dDef.conditionDescriptors) === JSON.stringify(dNo.conditionDescriptors)],
				["marketingPrice", JSON.stringify(dDef.marketingPrice) === JSON.stringify(dNo.marketingPrice)],
				["imageUrls.length", dDef.imageUrls.length === dNo.imageUrls.length],
			] as const;
			console.log(`  parity: ${fields.map(([k, ok]) => `${ok ? "✓" : "✗"} ${k}`).join("  ")}`);
			if (dDef.aspects.length !== dNo.aspects.length) {
				console.log(`     aspects diff: default=${dDef.aspects.length} no=${dNo.aspects.length}`);
			}
		} catch (err) {
			console.log(`  ! error: ${(err as Error).message}`);
		}
		console.log("");
	}
	process.exit(0);
}
main().catch((err) => { console.error(err); process.exit(2); });
