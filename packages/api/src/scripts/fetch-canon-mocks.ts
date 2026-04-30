/**
 * One-shot: pull real Canon EF 50mm f/1.8 STM listings via the in-tree
 * scraper, download each thumbnail, transform it through Gemini's image
 * model into a clean white-background catalog shot, then verify the
 * transform with a second Gemini call (same product? identifying marks
 * preserved?). Outputs:
 *
 *   /tmp/flipagent-mocks/originals/<itemId>.jpg
 *   /tmp/flipagent-mocks/transformed/<itemId>.jpg
 *   /tmp/flipagent-mocks/listings.json   ← scraper payload (active)
 *   /tmp/flipagent-mocks/sold.json       ← scraper payload (sold)
 *   /tmp/flipagent-mocks/verdicts.json   ← per-image similarity report
 *
 * Run from repo root:
 *   npm --workspace @flipagent/api exec -- tsx src/scripts/fetch-canon-mocks.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GoogleGenAI } from "@google/genai";
import { config } from "../config.js";
import { scrapeSearch } from "../services/ebay/scrape/client.js";

const OUT_DIR = "/tmp/flipagent-mocks";
const KEYWORD = "Canon EF 50mm f/1.8 STM";
const POOL_SIZE = 18;
const MIN_ORIG_BYTES = 30_000;
const TARGET_WINNERS = 6;
const IMAGE_MODEL = "gemini-2.5-flash-image";
const VERIFY_MODEL = "gemini-2.5-flash";

const TRANSFORM_PROMPT =
	"Re-render this product photo as a clean e-commerce catalog shot. " +
	"Hard requirements: pure white seamless background (#FFFFFF, no shadow plate, no gradient); " +
	"the EXACT same physical lens — preserve every visible marking, label, ring text, focal length / aperture printing, " +
	"button positions, mount color, and any wear or scuffs visible in the original; " +
	"centered, slight 3/4 angle if the original is angled, otherwise match the original orientation; " +
	"soft even studio lighting, no harsh shadows; no added text, no watermark, no border. " +
	"Output only the modified image.";

const VERIFY_PROMPT =
	"You are comparing two photos. Photo A is the original eBay listing for a Canon EF 50mm f/1.8 STM lens. Photo B is a re-rendered catalog version. " +
	"Return strict JSON: { \"sameProduct\": boolean, \"confidence\": 0..1, \"isThe50mmSTMLens\": boolean, \"hasHallucinatedText\": boolean, \"differences\": string[] }. " +
	"ZERO TOLERANCE rules — set sameProduct=false if ANY apply: " +
	"(a) the rendered lens shows a different model (any of: 50mm 1.4, 50mm 1.2, USM, ULTRASONIC, II, L-series red ring, white-barrel L); " +
	"(b) the focal length, aperture (1:1.8), or 'STM' text is changed, missing, or invented; " +
	"(c) Photo B is not a lens at all (e.g. just a body cap, just a lens cap, accessory only); " +
	"(d) any printed text on the barrel differs in spelling, numerals, or position. " +
	"isThe50mmSTMLens=true only if Photo A clearly shows the Canon EF 50mm f/1.8 STM lens body (lens cap alone or a different model = false). " +
	"hasHallucinatedText=true if Photo B shows any text that wasn't legibly present in Photo A. " +
	"List differences as terse phrases. Output JSON only, no prose.";

interface Verdict {
	itemId: string;
	originalUrl: string;
	sameProduct: boolean;
	confidence: number;
	isThe50mmSTMLens: boolean;
	hasHallucinatedText: boolean;
	differences: string[];
}

async function main(): Promise<void> {
	if (!config.GOOGLE_API_KEY) throw new Error("GOOGLE_API_KEY not set in .env");
	await mkdir(join(OUT_DIR, "originals"), { recursive: true });
	await mkdir(join(OUT_DIR, "transformed"), { recursive: true });

	console.log(`[1/4] scrapeSearch — active "${KEYWORD}" (used, BIN, lowest price)`);
	const active = await scrapeSearch({
		q: KEYWORD,
		binOnly: true,
		conditionIds: ["3000"],
		sort: "pricePlusShippingLowest",
		limit: 24,
	});
	const summaries = ("itemSummaries" in active ? active.itemSummaries : []) ?? [];
	const withImages = summaries.filter((s) => s.image?.imageUrl);
	console.log(`      ${summaries.length} active listings, ${withImages.length} have image URLs`);
	await writeFile(join(OUT_DIR, "listings.json"), JSON.stringify(active, null, "\t"));

	console.log("[1/4] scrapeSearch — sold (90d)");
	const sold = await scrapeSearch({ q: KEYWORD, soldOnly: true, conditionIds: ["3000"], limit: 60 });
	const soldCount = ("itemSales" in sold ? sold.itemSales?.length : 0) ?? 0;
	console.log(`      ${soldCount} sold rows`);
	await writeFile(join(OUT_DIR, "sold.json"), JSON.stringify(sold, null, "\t"));

	const picks = withImages.slice(0, POOL_SIZE);
	console.log(`[2/4] downloading ${picks.length} candidates (skip <${MIN_ORIG_BYTES / 1000}KB)`);
	const originals: { itemId: string; url: string; localPath: string; mime: string; b64: string }[] = [];
	for (const item of picks) {
		const url = item.image!.imageUrl!.replace(/s-l\d+\.jpg/, "s-l1600.jpg");
		const res = await fetch(url);
		if (!res.ok) {
			console.log(`      - ${item.itemId} fetch ${res.status}`);
			continue;
		}
		const buf = Buffer.from(await res.arrayBuffer());
		if (buf.length < MIN_ORIG_BYTES) {
			console.log(`      - ${item.itemId} skip (${(buf.length / 1024).toFixed(0)} KB)`);
			continue;
		}
		const mime = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "image/jpeg";
		const ext = mime.endsWith("png") ? "png" : "jpg";
		const localPath = join(OUT_DIR, "originals", `${item.itemId.replace(/\W+/g, "_")}.${ext}`);
		await writeFile(localPath, buf);
		originals.push({ itemId: item.itemId, url, localPath, mime, b64: buf.toString("base64") });
		console.log(`      ✓ ${item.itemId} (${(buf.length / 1024).toFixed(0)} KB)`);
	}

	const ai = new GoogleGenAI({ apiKey: config.GOOGLE_API_KEY });

	console.log(`[3/4] Gemini ${IMAGE_MODEL} — catalog re-render`);
	const transformed: { itemId: string; b64: string; mime: string; localPath: string }[] = [];
	for (const orig of originals) {
		try {
			const res = await ai.models.generateContent({
				model: IMAGE_MODEL,
				contents: [
					{
						role: "user",
						parts: [{ text: TRANSFORM_PROMPT }, { inlineData: { mimeType: orig.mime, data: orig.b64 } }],
					},
				],
			});
			const parts = res.candidates?.[0]?.content?.parts ?? [];
			const imgPart = parts.find((p) => p.inlineData?.data);
			if (!imgPart?.inlineData?.data) {
				console.log(`      ! ${orig.itemId} — no image in response`);
				continue;
			}
			const data = imgPart.inlineData.data;
			const mime = imgPart.inlineData.mimeType ?? "image/png";
			const ext = mime.endsWith("png") ? "png" : "jpg";
			const localPath = join(OUT_DIR, "transformed", `${orig.itemId.replace(/\W+/g, "_")}.${ext}`);
			await writeFile(localPath, Buffer.from(data, "base64"));
			transformed.push({ itemId: orig.itemId, b64: data, mime, localPath });
			console.log(`      ✓ ${orig.itemId} → ${localPath}`);
		} catch (err) {
			console.log(`      ! ${orig.itemId} — ${(err as Error).message}`);
		}
	}

	console.log(`[4/4] Gemini ${VERIFY_MODEL} — verify same-product`);
	const verdicts: Verdict[] = [];
	for (const orig of originals) {
		const tx = transformed.find((t) => t.itemId === orig.itemId);
		if (!tx) continue;
		try {
			const res = await ai.models.generateContent({
				model: VERIFY_MODEL,
				contents: [
					{
						role: "user",
						parts: [
							{ text: VERIFY_PROMPT },
							{ text: "Photo A (original):" },
							{ inlineData: { mimeType: orig.mime, data: orig.b64 } },
							{ text: "Photo B (re-rendered):" },
							{ inlineData: { mimeType: tx.mime, data: tx.b64 } },
						],
					},
				],
				config: { responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
			});
			const text = res.text ?? "{}";
			const parsed = JSON.parse(text);
			const v: Verdict = {
				itemId: orig.itemId,
				originalUrl: orig.url,
				sameProduct: Boolean(parsed.sameProduct),
				confidence: Number(parsed.confidence ?? 0),
				isThe50mmSTMLens: Boolean(parsed.isThe50mmSTMLens),
				hasHallucinatedText: Boolean(parsed.hasHallucinatedText),
				differences: Array.isArray(parsed.differences) ? parsed.differences : [],
			};
			verdicts.push(v);
			const pass = v.sameProduct && v.isThe50mmSTMLens && !v.hasHallucinatedText && v.differences.length === 0;
			const mark = pass ? "✓" : "✗";
			console.log(
				`      ${mark} ${orig.itemId} same=${v.sameProduct} stm=${v.isThe50mmSTMLens} halluc=${v.hasHallucinatedText} diffs=${v.differences.length}`,
			);
			if (v.differences.length) console.log(`         ${v.differences.join(" | ")}`);
		} catch (err) {
			console.log(`      ! ${orig.itemId} verify failed — ${(err as Error).message}`);
		}
	}

	await writeFile(join(OUT_DIR, "verdicts.json"), JSON.stringify(verdicts, null, "\t"));
	const winners = verdicts.filter(
		(v) => v.sameProduct && v.isThe50mmSTMLens && !v.hasHallucinatedText && v.differences.length === 0,
	);
	const winnerIds = winners.slice(0, TARGET_WINNERS).map((v) => v.itemId);
	await writeFile(join(OUT_DIR, "winners.json"), JSON.stringify(winnerIds, null, "\t"));
	console.log(`\n${winners.length}/${verdicts.length} pass strict gate. Top ${winnerIds.length} → winners.json:`);
	for (const id of winnerIds) console.log(`  ${id}`);
	console.log(`Originals:    ${join(OUT_DIR, "originals")}`);
	console.log(`Transformed:  ${join(OUT_DIR, "transformed")}`);
	console.log(`Verdicts:     ${join(OUT_DIR, "verdicts.json")}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
