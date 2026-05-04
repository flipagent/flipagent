/**
 * Find a Pokemon Charizard #228 PSA 10 listing in our existing snapshot
 * pool whose conditionDescriptors correctly say Grade=10 (not the
 * miscoded Grade=6 of the current seed). Picks the cleanest gold-MATCH
 * for use as the new dataset seed.
 */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { apiKeys } from "../src/db/schema.js";
import { detailFetcherFor } from "../src/services/items/detail.js";

const APIKEY_ID = process.env.APIKEY_ID ?? "d3b36b4f-4e4d-41a5-94e6-1b57f3d7261d";
const DATASET = "pokemon-charizard-228-psa10";

async function main(): Promise<void> {
	const reg = JSON.parse(readFileSync("scripts/.bench-out/datasets.json", "utf8")) as { datasets: { id: string; labels: string }[] };
	const cfg = reg.datasets.find((d) => d.id === DATASET);
	if (!cfg) throw new Error(`dataset ${DATASET} not in registry`);
	const labels = JSON.parse(readFileSync(cfg.labels, "utf8")) as { items: Record<string, { label: string }> };
	const matchIds = Object.entries(labels.items).filter(([, l]) => l.label === "match").map(([id]) => id);

	const apiKey = (await db.select().from(apiKeys).where(eq(apiKeys.id, APIKEY_ID)))[0];
	const fetchDetail = detailFetcherFor(apiKey);

	console.log(`Inspecting ${matchIds.length} gold-MATCH items for cleanest aspects...`);
	console.log("Need: title says PSA 10, conditionDescriptors Grade=10, Card Condition not contradictory");
	console.log("");

	const candidates: Array<{ itemId: string; price: string; title: string; clean: boolean; reason: string }> = [];
	for (const id of matchIds) {
		const d = await fetchDetail({ itemId: id }).catch(() => null);
		if (!d) continue;
		const grade = d.conditionDescriptors?.find((c) => c.name === "Grade")?.values?.[0]?.content;
		const cardCond = d.conditionDescriptors?.find((c) => c.name === "Card Condition")?.values?.[0]?.content;
		const titleHasPsa10 = /\bpsa\s*10\b/i.test(d.title);
		const title228 = /#?228|228\/197/i.test(d.title);
		const clean = titleHasPsa10 && title228 && grade === "10";
		const reason = `grade=${grade ?? "?"}  cardCond=${cardCond ?? "(none)"}  titleOK=${titleHasPsa10 && title228}`;
		candidates.push({
			itemId: id,
			price: d.price?.value ?? "?",
			title: d.title.slice(0, 90),
			clean,
			reason,
		});
	}
	const cleanOnes = candidates.filter((c) => c.clean);
	console.log(`Clean candidates (Grade=10 + title has PSA 10 + #228): ${cleanOnes.length}/${candidates.length}\n`);
	console.log("All candidates' detail (sample):");
	for (const c of candidates.slice(0, 25)) {
		console.log(`  ${c.itemId}  $${c.price}  ${c.reason}`);
		console.log(`    ${c.title}`);
	}
	process.exit(0);
}
main().catch((err) => { console.error(err); process.exit(2); });
