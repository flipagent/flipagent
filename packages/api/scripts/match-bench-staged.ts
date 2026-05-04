/**
 * Per-stage model split bench. Use one model for triage, another for verify.
 *
 *   TRIAGE_PROVIDER=google TRIAGE_MODEL=gemini-3.1-flash-lite-preview \
 *   VERIFY_PROVIDER=openai VERIFY_MODEL=gpt-5.4-mini \
 *   SNAPSHOT=... USE_IMAGES=false \
 *   node --env-file=.env --import tsx scripts/match-bench-staged.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import type { ItemSummary } from "@flipagent/types/ebay/buy";
import { db } from "../src/db/client.js";
import { apiKeys, type ApiKey } from "../src/db/schema.js";
import { detailFetcherFor } from "../src/services/items/detail.js";
import { matchPoolWithLlm } from "../src/services/match/matcher.js";
import { createGoogleProvider } from "../src/services/match/llm/google.js";
import { createOpenAiProvider } from "../src/services/match/llm/openai.js";
import { Semaphore } from "../src/utils/semaphore.js";
import type { LlmProvider } from "../src/services/match/llm/index.js";

const SNAP = process.env.SNAPSHOT!;
if (!SNAP) throw new Error("SNAPSHOT required");
const APIKEY_ID = process.env.APIKEY_ID;

function makeProvider(p: string, m: string): LlmProvider {
	const sem = new Semaphore(Number.parseInt(process.env.LLM_MAX_CONCURRENT ?? "16", 10));
	let raw: LlmProvider;
	if (p === "google") raw = createGoogleProvider(m);
	else if (p === "openai") raw = createOpenAiProvider(m);
	else throw new Error(`bad provider ${p}`);
	return {
		name: raw.name,
		model: raw.model,
		complete: (req) => sem.run(() => raw.complete(req)),
	};
}

async function main(): Promise<void> {
	const apiKey: ApiKey | undefined = APIKEY_ID
		? (await db.select().from(apiKeys).where(eq(apiKeys.id, APIKEY_ID)))[0]
		: undefined;

	const snap = JSON.parse(readFileSync(SNAP, "utf8")) as {
		seed: ItemSummary;
		soldRaw: ItemSummary[];
		activeRaw: ItemSummary[];
	};
	const soldIds = new Set(snap.soldRaw.map((s) => s.itemId));
	const dedupedPool: ItemSummary[] = [...snap.soldRaw, ...snap.activeRaw.filter((a) => !soldIds.has(a.itemId))];

	const triageProvider = makeProvider(process.env.TRIAGE_PROVIDER!, process.env.TRIAGE_MODEL!);
	const verifyProvider = makeProvider(process.env.VERIFY_PROVIDER!, process.env.VERIFY_MODEL!);
	const useImages = process.env.USE_IMAGES !== "false";

	console.log(`[staged] triage=${triageProvider.name}/${triageProvider.model}  verify=${verifyProvider.name}/${verifyProvider.model}  useImages=${useImages}`);

	const t0 = performance.now();
	const result = await matchPoolWithLlm(
		snap.seed,
		dedupedPool,
		{ useImages, triageProvider, verifyProvider },
		detailFetcherFor(apiKey),
	);
	const totalMs = Math.round(performance.now() - t0);
	console.log(`[staged] TOTAL ${totalMs}ms  match=${result.totals.match} reject=${result.totals.reject}`);

	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const out = {
		stamp,
		snapPath: SNAP,
		provider: `staged:${triageProvider.name}+${verifyProvider.name}`,
		model: `${triageProvider.model}+${verifyProvider.model}`,
		totalMs,
		match: result.match.map((m) => ({ itemId: m.item.itemId, title: m.item.title, reason: m.reason })),
		reject: result.reject.map((m) => ({ itemId: m.item.itemId, title: m.item.title, reason: m.reason })),
	};
	const path = `scripts/.bench-out/match-staged-${triageProvider.model}+${verifyProvider.model}-${stamp}.json`;
	writeFileSync(path, JSON.stringify(out, null, 2));
	console.log(`[staged] → ${path}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
