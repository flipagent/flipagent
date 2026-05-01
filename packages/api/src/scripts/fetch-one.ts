import { writeFile } from "node:fs/promises";
import "../config.js";
import { scrapeSearch } from "../services/ebay/scrape/client.js";

const q = process.argv[2]!;
const saveAs = process.argv[3];
const r = await scrapeSearch({ q, binOnly: true, conditionIds: ["3000"], sort: "pricePlusShippingLowest", limit: 8 });
const items = "itemSummaries" in r ? (r.itemSummaries ?? []) : [];

for (const [i, it] of items.slice(0, 6).entries()) {
	console.log(`[${i}] $${it.price?.value} ${it.title.slice(0, 70)}  | ${it.image?.imageUrl}`);
}

if (saveAs && items.length) {
	const target = items[0]!;
	const url = (target.image?.imageUrl ?? "").replace(/s-l\d+\.jpg/, "s-l800.jpg");
	const res = await fetch(url);
	const buf = Buffer.from(await res.arrayBuffer());
	await writeFile(`/tmp/preview-${saveAs}.jpg`, buf);
	console.log(`\nsaved /tmp/preview-${saveAs}.jpg (${(buf.length / 1024).toFixed(0)} KB) — itemId=${target.itemId}`);
}
