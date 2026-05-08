import { scrapeCatalogProduct, scrapeCatalogSearch } from "../services/ebay/scrape/catalog.js";
import { scrapeItemDetail, scrapeSearch } from "../services/ebay/scrape/client.js";

function fmt(label: string, obj: unknown) {
	const o = obj as Record<string, unknown>;
	const keys = o ? Object.keys(o) : [];
	const arr = (
		(o?.itemSummaries as unknown[]) ||
		(o?.itemSales as unknown[]) ||
		(o?.productSummaries as unknown[]) ||
		[]
	).length;
	console.log(label, "| keys:", keys, "| arr-len:", arr, "| total:", o?.total ?? "—");
}

async function main() {
	console.log("=== 1) active search (q=rolex) ===");
	fmt("active", await scrapeSearch({ q: "rolex", limit: 2 }));

	console.log("=== 2) sold + binOnly + conditionIds ===");
	fmt("sold", await scrapeSearch({ q: "rolex", soldOnly: true, binOnly: true, conditionIds: ["3000"], limit: 2 }));

	console.log("=== 3) Sourcing primary (empty-q + categoryIds) ===");
	fmt("sourcing", await scrapeSearch({ categoryIds: "15709", limit: 2 }));

	console.log("=== 4) item detail ===");
	const d = await scrapeItemDetail("147241208850");
	console.log("detail keys:", d ? Object.keys(d).slice(0, 30) : "NULL");
	console.log("price:", d?.price, "| categoryId:", d?.categoryId, "| seller.username:", d?.seller?.username);

	console.log("=== 5) catalog product ===");
	const p = await scrapeCatalogProduct("4062765295");
	console.log("product keys:", p ? Object.keys(p) : "NULL", "| brand:", p?.brand, "| upc:", p?.upc);

	console.log("=== 6) catalog search FULL ===");
	const s = await scrapeCatalogSearch({ q: "apple airpods", limit: 3, fieldgroups: "FULL" });
	console.log(
		"search keys:",
		Object.keys(s),
		"| summaries:",
		s.productSummaries?.length,
		"| refinement:",
		!!s.refinement,
	);
}

main().catch((err) => {
	console.error("smoke failed:", err);
	process.exit(1);
});
