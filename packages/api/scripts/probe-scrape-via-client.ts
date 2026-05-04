/**
 * Verify Phase 1 parser improvements end-to-end:
 * call scrapeItemDetail() and dump the new fields surfaced through
 * the scrape→normalize pipeline (the same path bridge uses).
 */
import { scrapeItemDetail } from "../src/services/ebay/scrape/client.js";

const ids = (process.env.ITEMS ?? "").split(",").filter(Boolean);
if (ids.length === 0) throw new Error("ITEMS env required");

async function main(): Promise<void> {
	for (const id of ids) {
		const d = await scrapeItemDetail(id);
		if (!d) { console.log(id, "no detail"); continue; }
		console.log(`════════════════════════════════════════════════════════════════════════════════`);
		console.log(`${id}  —  ${d.title?.slice(0, 70)}`);
		console.log(`────────────────────────────────────────────────────────────────────────────────`);
		console.log(`  condition:             ${d.condition ?? "(null)"}    conditionId: ${d.conditionId ?? "(null)"}`);
		console.log(`  categoryIdPath:        ${d.categoryIdPath ?? "(null)"}`);
		console.log(`  categoryPath:          ${d.categoryPath ?? "(null)"}`);
		console.log(`  epid:                  ${d.epid ?? "(null)"}`);
		console.log(`  mpn:                   ${d.mpn ?? "(null)"}`);
		console.log(`  lotSize:               ${d.lotSize ?? "(null)"}`);
		console.log(`  conditionDescription:  ${d.conditionDescription?.slice(0, 100) ?? "(null)"}`);
		console.log(`  conditionDescriptors:  ${JSON.stringify(d.conditionDescriptors) ?? "(null)"}`);
		console.log(`  marketingPrice:        ${JSON.stringify(d.marketingPrice) ?? "(null)"}`);
		console.log(`  primaryItemGroup:      ${JSON.stringify(d.primaryItemGroup) ?? "(null)"}`);
		console.log(`  shortDescription:      ${d.shortDescription?.slice(0, 100) ?? "(null)"}`);
		console.log("");
	}
	process.exit(0);
}
main().catch((err) => { console.error(err); process.exit(2); });
