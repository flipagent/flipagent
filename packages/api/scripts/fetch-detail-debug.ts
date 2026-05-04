/**
 * Fetch full detail for a specific itemId via the same path the matcher uses
 * during verify. Shows what aspects/variations are actually available to the
 * model — useful when the snapshot's search-time summary has no aspects.
 */
import { eq } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { apiKeys } from "../src/db/schema.js";
import { detailFetcherFor } from "../src/services/items/detail.js";

const ITEMS = (process.env.ITEMS ?? "").split(",").filter(Boolean);
if (ITEMS.length === 0) throw new Error("ITEMS env required (comma-separated itemIds)");

const APIKEY_ID = process.env.APIKEY_ID ?? "d3b36b4f-4e4d-41a5-94e6-1b57f3d7261d";

async function main(): Promise<void> {
	const rows = await db.select().from(apiKeys).where(eq(apiKeys.id, APIKEY_ID));
	const fetchDetail = detailFetcherFor(rows[0]);
	for (const id of ITEMS) {
		console.log(`════════════════════════════════════════════════════════════════════════════════`);
		console.log(`itemId: ${id}`);
		const d = await fetchDetail({ itemId: id });
		if (!d) { console.log("(no detail)"); continue; }
		console.log(`title: ${d.title}`);
		console.log(`brand: ${d.brand ?? "?"}`);
		console.log(`condition: ${d.condition ?? "?"}`);
		console.log(`price: $${d.price?.value ?? "?"}`);
		if (d.localizedAspects && d.localizedAspects.length > 0) {
			console.log(`aspects (${d.localizedAspects.length}):`);
			for (const a of d.localizedAspects) console.log(`  - ${a.name}: ${a.value}`);
		} else {
			console.log("aspects: (none)");
		}
		if (d.variations && d.variations.length > 0) {
			console.log(`variations (${d.variations.length}):`);
			for (const v of d.variations.slice(0, 10)) {
				const aspectStr = v.aspects.map((a) => `${a.name}=${a.value}`).join(", ");
				const priceStr = v.priceCents != null ? `$${(v.priceCents / 100).toFixed(2)}` : "n/a";
				console.log(`  - ${aspectStr || "(no aspect)"} — ${priceStr}`);
			}
		}
		console.log("");
	}
	process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(2); });
