/**
 * Live-fetch one eBay PDP via the scraper, then probe the raw HTML
 * for each field we currently DON'T extract from scrape:
 *   - epid (catalog product id)
 *   - conditionDescriptors (graded card grade/cert structured)
 *   - conditionDescription (long-form seller note)
 *   - lotSize
 *   - marketingPrice (strikethrough/list price)
 *   - mpn (Manufacturer Part Number)
 *   - additionalImages (all photos, not just first)
 *
 * Reports for each: present in HTML? where? sample value?
 */
import { writeFileSync } from "node:fs";
import { fetchHtmlViaScraperApi } from "../src/services/ebay/scrape/scraper-api/index.js";

const ITEMS = (process.env.ITEMS ?? "").split(",").filter(Boolean);
if (ITEMS.length === 0) throw new Error("ITEMS env required (comma-separated legacy ids)");

interface Probe {
	field: string;
	patterns: RegExp[];
	noteIfFound?: (m: RegExpExecArray) => string;
}

const PROBES: Probe[] = [
	{
		field: "epid (catalog product id)",
		patterns: [
			/"epid"\s*:\s*"?(\d{6,})/,
			/\/p\/(\d{6,})/,
			/[?&]epid=(\d{6,})/,
			/"productId"\s*:\s*"?(\d{6,})/,
		],
	},
	{
		field: "conditionDescriptors (PSA grade etc.)",
		patterns: [
			/"conditionDescriptors?"\s*:\s*\[/,
			/"PSA"|"BGS"|"CGC"|"SGC"/,
			/"certificationNumber"|"Cert ?Number"|"Certification Number"/i,
			/"Grade"\s*:\s*"\d/,
			/Professional Sports Authenticator/,
		],
	},
	{
		field: "conditionDescription (long seller note)",
		patterns: [
			/"conditionDescription"\s*:\s*"([^"]+)"/,
			/d-item-condition-text[\s\S]{0,500}/,
			/"Condition Description"|condition-description/i,
		],
	},
	{
		field: "lotSize",
		patterns: [
			/"lotSize"\s*:\s*"?(\d+)/,
			/>Number in lot</i,
			/>Number in pack</i,
		],
	},
	{
		field: "marketingPrice (strikethrough / discount)",
		patterns: [
			/"marketingPrice"\s*:\s*\{/,
			/"originalPrice"\s*:/,
			/STRIKETHROUGH|ux-textspans--STRIKETHROUGH/,
			/"discountAmount"|"discountPercentage"/,
			/wasPrice|x-was-price/i,
		],
	},
	{
		field: "mpn (Manufacturer Part Number)",
		patterns: [
			/"mpn"\s*:\s*"([^"]+)"/i,
			/>MPN<\/[a-z]+>\s*<[^>]+>([^<]+)/i,
			/>Manufacturer Part Number</i,
		],
	},
	{
		field: "additionalImages (all photos)",
		patterns: [
			/"additionalImages"\s*:\s*\[/,
			/"imageUrls"\s*:\s*\[/,
			/i\.ebayimg\.com\/images\/g\/[^\/]+\/s-l1600/g,
		],
	},
	{
		field: "qualifiedPrograms / authenticityGuarantee",
		patterns: [
			/AUTHENTICITY_GUARANTEE/,
			/authenticityGuarantee/,
			/qualifiedPrograms/,
		],
	},
	{
		field: "primaryItemGroup (multi-variation parent)",
		patterns: [
			/"primaryItemGroup"\s*:\s*\{/,
			/"itemGroupId"\s*:\s*"(\d+)"/,
			/"itemGroupHref"/,
		],
	},
	{
		field: "seller feedback score",
		patterns: [
			/"feedbackScore"\s*:\s*(\d+)/,
			/seller-info-feedback/i,
			/% positive feedback/i,
		],
	},
];

async function main(): Promise<void> {
	for (const id of ITEMS) {
		const url = `https://www.ebay.com/itm/${encodeURIComponent(id)}`;
		console.log(`════════════════════════════════════════════════════════════════════════════════`);
		console.log(`itemId: ${id}   url: ${url}`);
		console.log(`════════════════════════════════════════════════════════════════════════════════`);
		const html = await fetchHtmlViaScraperApi(url);
		const sizeKb = (html.length / 1024).toFixed(1);
		console.log(`HTML size: ${sizeKb} KB`);
		writeFileSync(`/tmp/scrape-probe-${id}.html`, html);

		for (const probe of PROBES) {
			let found = false;
			let sample = "";
			let count = 0;
			for (const pat of probe.patterns) {
				const isGlobal = pat.flags.includes("g");
				if (isGlobal) {
					const matches = html.match(pat);
					if (matches) {
						found = true;
						count = matches.length;
						sample = matches[0]!.slice(0, 80);
					}
				} else {
					const m = pat.exec(html);
					if (m) {
						found = true;
						sample = (m[1] ?? m[0]).slice(0, 80);
						break;
					}
				}
			}
			const status = found ? "✅" : "❌";
			const detail = found ? `  →  ${sample}${count > 1 ? `  (${count}×)` : ""}` : "";
			console.log(`  ${status} ${probe.field}${detail}`);
		}
		console.log("");
	}
	process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(2); });
