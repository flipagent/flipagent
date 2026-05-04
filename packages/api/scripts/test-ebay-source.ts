/**
 * A/B test: Oxylabs source: "universal" vs source: "ebay_product".
 * Same eBay items, different source. Measure latency, response size, parity.
 */
import { JSDOM } from "jsdom";
import { parseEbayDetailHtml } from "@flipagent/ebay-scraper";
import { config } from "../src/config.js";

const ITEMS = (process.env.ITEMS ?? "187760409559,127815598917,406185837129,186397216258,178095973302").split(",");

interface OxylabsResult { content: string; status_code: number; }
interface OxylabsResponse { results?: OxylabsResult[]; }

async function fetchOxy(body: Record<string, unknown>): Promise<{ html: string; ms: number; status: number }> {
	const auth = Buffer.from(`${config.SCRAPER_API_USERNAME}:${config.SCRAPER_API_PASSWORD}`).toString("base64");
	const t0 = performance.now();
	const res = await fetch("https://realtime.oxylabs.io/v1/queries", {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
		body: JSON.stringify(body),
	});
	const ms = Math.round(performance.now() - t0);
	if (!res.ok) {
		const txt = await res.text().catch(() => "");
		throw new Error(`http ${res.status}: ${txt.slice(0, 200)}`);
	}
	const j = (await res.json()) as OxylabsResponse;
	const r = j.results?.[0];
	if (!r) throw new Error("no result");
	return { html: r.content, ms, status: r.status_code };
}

const dom = (h: string) => new JSDOM(h).window.document;

async function main(): Promise<void> {
	console.log(`Compare source: universal vs ebay_product\n`);
	const results: Array<{ id: string; uniMs?: number; ebayMs?: number; speedup?: number }> = [];
	for (const id of ITEMS) {
		console.log(`════ ${id}`);
		const url = `https://www.ebay.com/itm/${id}`;
		try {
			const uni = await fetchOxy({ source: "universal", url, geo_location: "United States" });
			const ebay = await fetchOxy({ source: "ebay_product", product_id: id });
			const dUni = parseEbayDetailHtml(uni.html, url, dom);
			const dEbay = parseEbayDetailHtml(ebay.html, url, dom);
			const sizeUni = (uni.html.length / 1024).toFixed(0);
			const sizeEbay = (ebay.html.length / 1024).toFixed(0);
			console.log(`  universal:    ${uni.ms}ms   ${sizeUni}KB   title="${dUni.title.slice(0, 50)}"`);
			console.log(`  ebay_product: ${ebay.ms}ms   ${sizeEbay}KB   title="${dEbay.title.slice(0, 50)}"`);
			console.log(`  speedup: ${(uni.ms / ebay.ms).toFixed(2)}x`);
			const fields = [
				["title", dUni.title === dEbay.title],
				["condition", dUni.condition === dEbay.condition],
				["epid", dUni.epid === dEbay.epid],
				["mpn", dUni.mpn === dEbay.mpn],
				["aspects", dUni.aspects.length === dEbay.aspects.length],
				["variations", JSON.stringify(dUni.variations) === JSON.stringify(dEbay.variations)],
				["conditionDescriptors", JSON.stringify(dUni.conditionDescriptors) === JSON.stringify(dEbay.conditionDescriptors)],
				["marketingPrice", JSON.stringify(dUni.marketingPrice) === JSON.stringify(dEbay.marketingPrice)],
				["images", dUni.imageUrls.length === dEbay.imageUrls.length],
			] as const;
			console.log(`  parity: ${fields.map(([k, ok]) => `${ok ? "✓" : "✗"} ${k}`).join(" ")}`);
			results.push({ id, uniMs: uni.ms, ebayMs: ebay.ms, speedup: uni.ms / ebay.ms });
		} catch (err) {
			console.log(`  ! error: ${(err as Error).message}`);
			results.push({ id });
		}
		console.log("");
	}
	console.log("════ SUMMARY ════");
	const validResults = results.filter((r) => r.uniMs && r.ebayMs);
	if (validResults.length === 0) {
		console.log("(no valid measurements)");
		process.exit(0);
	}
	const avgUni = Math.round(validResults.reduce((a, r) => a + (r.uniMs ?? 0), 0) / validResults.length);
	const avgEbay = Math.round(validResults.reduce((a, r) => a + (r.ebayMs ?? 0), 0) / validResults.length);
	console.log(`avg universal:    ${avgUni}ms`);
	console.log(`avg ebay_product: ${avgEbay}ms`);
	console.log(`avg speedup: ${(avgUni / avgEbay).toFixed(2)}x`);
	process.exit(0);
}
main().catch((err) => { console.error(err); process.exit(2); });
