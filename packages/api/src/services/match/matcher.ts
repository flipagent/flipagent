/**
 * Two-pass LLM product matcher. Provider-agnostic — picks Anthropic /
 * OpenAI / Google from env via `pickProvider()`.
 *
 *   Pass 1 — batch triage. One model call sees the candidate and the
 *   full pool's titles / conditions / prices (and thumbnail images
 *   when `useImages`). It drops any pool item that is obviously a
 *   different product.
 *
 *   Pass 2 — deep verify. Each survivor's full ItemDetail (aspects +
 *   image set) is fetched and compared to the candidate's detail, one
 *   call per pair. The model returns a strict yes/no on "same product
 *   in the same configuration" — different reference, different
 *   finish, different colour, different condition, or missing
 *   accessories all count as `reject`.
 *
 * The two-pass shape exists for cost: pass 1 (one batched call,
 * shallow data) cuts the pool to a manageable size; pass 2 (one call
 * per survivor, rich data) does the careful work only on items that
 * passed the cheap filter.
 */

import type { MatchedItem, MatchResponse } from "@flipagent/types";
import type { ItemDetail, ItemSummary } from "@flipagent/types/ebay/buy";
import { getCachedMatchDecision, setCachedMatchDecision } from "./decision-cache.js";
import { type LlmContent, type LlmProvider, pickProvider } from "./llm/index.js";

// Both prompts share one mental model: "would a buyer expecting the candidate
// accept this as a substitute?" — phrased that way the rule generalises across
// watches / electronics / sneakers / collectibles / fashion without enumerating
// per-category axes. Triage is lenient (cheap filter, only obvious drops);
// verify is strict (rich detail, commits yes/no).

const SYSTEM_TRIAGE = `You filter an eBay search-result POOL against a CANDIDATE listing.

For each pool item, decide whether it could plausibly be the same product as the candidate. Be inclusive — only "drop" when title / condition / price make it obvious a buyer would not accept it as a substitute (wrong brand, wrong model number, wrong product category, very different price tier). Borderline cases pass through; the next stage has full details and decides.

Return ONLY JSON: [{"i":0,"decision":"keep"|"drop","reason":"short"},...]. Indices match input order. Keep each "reason" to ≤8 words; the verifier stage gets the long form.`;

const SYSTEM_VERIFY = `You verify each ITEM against a CANDIDATE on eBay. Frame: would a buyer expecting the candidate accept this item as a substitute?

PRIMARY SIGNALS — treat as authoritative:
- Brand
- Model / reference / SKU / part number (what's printed on the product itself, e.g. "YA1264153")
- Condition tier — eBay tiers price separately. New, Refurbished, Used / Pre-Owned, and For Parts are NOT interchangeable.
- Variant when product-defining: colour, size, capacity, edition, year, generation, material (e.g. silver dial vs black dial, 36mm vs 38mm)

If the TITLE of both candidate and item carry the SAME reference number AND the condition tier matches AND no product-defining variant differs, the item IS the same product. Return "same: true".

NOISE — IGNORE these. Sellers fill localizedAspects inconsistently and often wrong:
- Country of Origin discrepancies (one says Italy, the other Switzerland — usually a seller mistake)
- UPC field saying "Does not apply", "N/A", or missing
- Department / gender labels (Unisex vs Men vs Women vs Unisex Adults) when the model is the same product
- "Type" or "Style" aspects that contradict the title — title wins
- Caseback / strap-material / band-color aspects when they're not in the title and the candidate's title doesn't mention them either
- Bundle aspects ("with original box and papers", warranty card) UNLESS they materially change resale value at this condition tier
- Marketing copy / wording / photo angle differences

REJECT (return "same: false") only when an objective product-defining attribute differs:
- Different reference number in the TITLE (e.g. YA1264153 vs YA1264155)
- Different colour/size/material/year stated in BOTH titles
- Different condition tier
- Genuinely different model line

If only aspects differ but title + reference + condition all match, return "true".
Decide each item independently; one item's decision must not influence another.

Return ONLY a JSON array: [{"i":0,"same":true|false,"reason":"one short sentence"},...]. Indices match the [N] markers on the items.`;

interface TriageItem {
	i: number;
	decision: "keep" | "drop";
	reason: string;
}

interface VerifyResult {
	same: boolean;
	reason: string;
}

/* ----------------------------- pass 1: triage ----------------------------- */

function summariseForTriage(item: ItemSummary): string {
	const parts: string[] = [];
	parts.push(`title: ${item.title}`);
	if (item.condition) parts.push(`condition: ${item.condition}`);
	const price = item.lastSoldPrice?.value ?? item.price?.value;
	if (price) parts.push(`price: $${price}`);
	return parts.join(" | ");
}

/**
 * Items per triage chunk. Small enough that the model tracks each item
 * properly (large prompts → attention dilution → silent over-rejection)
 * and the JSON output stays well under any provider's max-tokens cap;
 * large enough that the system prompt amortises over a useful batch.
 */
const TRIAGE_CHUNK = 25;

async function triageChunk(
	provider: LlmProvider,
	candidate: ItemSummary,
	chunk: ReadonlyArray<{ idx: number; item: ItemSummary }>,
	useImages: boolean,
): Promise<TriageItem[]> {
	const candidateBlock = summariseForTriage(candidate);
	// Use the original pool index in the prompt so the model's `i` field
	// keys back to the global pool (caller doesn't have to remap).
	const poolBlocks = chunk.map(({ idx, item }) => `[${idx}] ${summariseForTriage(item)}`).join("\n");

	const user: LlmContent[] = [];
	if (useImages && candidate.image?.imageUrl) {
		user.push({ type: "text", text: "CANDIDATE IMAGE:" });
		user.push({ type: "image", imageUrl: candidate.image.imageUrl });
	}
	user.push({
		type: "text",
		text: `CANDIDATE\n${candidateBlock}\n\nPOOL\n${poolBlocks}`,
	});

	// Budget per chunk: ~250 tokens × chunk size + 2048 thinking-mode prelude.
	// At chunk=25 that's ~8.3K, well under any provider's 16K output cap.
	const maxTokens = Math.min(16000, Math.max(4096, 2048 + chunk.length * 250));
	const text = await provider.complete({ system: SYSTEM_TRIAGE, user, maxTokens });
	const items = parseJsonArray<TriageItem>(text);
	if (items.length === 0) {
		console.error(
			`[match.triage] empty parse; chunk=${chunk.length} maxTokens=${maxTokens} response=${JSON.stringify(text.slice(0, 600))}`,
		);
		throw new Error(`triage chunk returned no parseable entries (chunk size ${chunk.length}).`);
	}
	return items;
}

/**
 * Retry wrapper for a single triage chunk. LLM transient failures
 * (rate limits, network blips, occasional bad-JSON responses) are the
 * dominant cause of chunk-level errors and they almost always resolve
 * on the next attempt. 3 total attempts with 200ms / 400ms backoff
 * keeps tail latency bounded while catching the common case.
 */
async function triageChunkWithRetry(
	provider: LlmProvider,
	candidate: ItemSummary,
	chunk: ReadonlyArray<{ idx: number; item: ItemSummary }>,
	useImages: boolean,
): Promise<TriageItem[]> {
	const attempts = 3;
	let lastErr: unknown;
	for (let i = 0; i < attempts; i++) {
		try {
			return await triageChunk(provider, candidate, chunk, useImages);
		} catch (e) {
			lastErr = e;
			if (i < attempts - 1) {
				await new Promise((r) => setTimeout(r, 200 * 2 ** i));
			}
		}
	}
	throw lastErr;
}

async function triage(
	provider: LlmProvider,
	candidate: ItemSummary,
	pool: ReadonlyArray<ItemSummary>,
	useImages: boolean,
): Promise<Map<number, TriageItem>> {
	// Split pool into TRIAGE_CHUNK-sized batches, run all chunks in
	// parallel with per-chunk retries. After retries are exhausted, a
	// failed chunk's items are simply absent from the returned map —
	// `runMatcher` treats absence as "no triage signal, send to verify"
	// (lenient, matching the system prompt's design intent). Throw only
	// when *every* chunk fails after retries, so the caller can surface
	// a real error instead of returning an empty match.
	const chunks: { idx: number; item: ItemSummary }[][] = [];
	for (let i = 0; i < pool.length; i += TRIAGE_CHUNK) {
		const slice: { idx: number; item: ItemSummary }[] = [];
		for (let j = i; j < Math.min(i + TRIAGE_CHUNK, pool.length); j++) {
			const item = pool[j];
			if (item) slice.push({ idx: j, item });
		}
		if (slice.length > 0) chunks.push(slice);
	}

	const results = await Promise.allSettled(
		chunks.map((chunk) => triageChunkWithRetry(provider, candidate, chunk, useImages)),
	);

	const byIdx = new Map<number, TriageItem>();
	let okCount = 0;
	for (const r of results) {
		if (r.status === "fulfilled") {
			okCount++;
			for (const it of r.value) byIdx.set(it.i, it);
		} else {
			console.error("[match.triage] chunk failed after retries:", r.reason);
		}
	}
	if (okCount === 0 && chunks.length > 0) {
		throw new Error(`triage failed: every chunk errored (pool size ${pool.length}, ${chunks.length} chunks).`);
	}
	return byIdx;
}

/* --------------------------- pass 2: deep verify --------------------------- */

interface DetailLike {
	title: string;
	brand?: string;
	gtin?: string;
	condition?: string;
	categoryPath?: string;
	localizedAspects?: ReadonlyArray<{ name: string; value: string }>;
	image?: { imageUrl: string };
	price?: { value: string; currency: string };
}

function summariseDetail(d: DetailLike): string {
	const lines: string[] = [];
	lines.push(`title: ${d.title}`);
	if (d.brand) lines.push(`brand: ${d.brand}`);
	if (d.gtin) lines.push(`gtin: ${d.gtin}`);
	if (d.condition) lines.push(`condition: ${d.condition}`);
	if (d.categoryPath) lines.push(`category: ${d.categoryPath}`);
	if (d.price) lines.push(`price: $${d.price.value}`);
	if (d.localizedAspects && d.localizedAspects.length > 0) {
		lines.push("aspects:");
		for (const a of d.localizedAspects) lines.push(`  - ${a.name}: ${a.value}`);
	}
	return lines.join("\n");
}

interface VerifyEntry extends VerifyResult {
	i: number;
}

/**
 * Verify N items against the candidate in a single LLM call. Cuts cost
 * (system prompt + candidate detail amortised over N pairs) and removes
 * the parallel-fanout failure mode (one network blip used to drop a
 * survivor mid-batch). Caller chunks if N is large.
 */
async function verifyBatch(
	provider: LlmProvider,
	candidate: DetailLike,
	items: ReadonlyArray<DetailLike>,
	useImages: boolean,
): Promise<VerifyResult[]> {
	if (items.length === 0) return [];

	const user: LlmContent[] = [];
	if (useImages && candidate.image?.imageUrl) {
		user.push({ type: "text", text: "CANDIDATE IMAGE:" });
		user.push({ type: "image", imageUrl: candidate.image.imageUrl });
	}
	user.push({ type: "text", text: `CANDIDATE\n${summariseDetail(candidate)}` });
	user.push({ type: "text", text: `ITEMS (${items.length}):` });
	for (let i = 0; i < items.length; i++) {
		const it = items[i];
		if (!it) continue;
		if (useImages && it.image?.imageUrl) {
			user.push({ type: "text", text: `[${i}] IMAGE:` });
			user.push({ type: "image", imageUrl: it.image.imageUrl });
		}
		user.push({ type: "text", text: `[${i}]\n${summariseDetail(it)}` });
	}

	const text = await provider.complete({
		system: SYSTEM_VERIFY,
		user,
		// Generous: thinking-mode models (Gemini 2.5+, GPT-5) eat the same
		// budget for chain-of-thought, so a tight cap silently truncates the
		// JSON. ~256/item leaves headroom even with full thinking.
		maxTokens: 512 + items.length * 256,
	});
	const arr = parseJsonArray<VerifyEntry>(text);
	const out: VerifyResult[] = items.map(() => ({ same: false, reason: "verifier returned no entry" }));
	for (const r of arr) {
		if (typeof r.i === "number" && r.i >= 0 && r.i < items.length) {
			out[r.i] = { same: !!r.same, reason: r.reason ?? "" };
		}
	}
	return out;
}

// Cap per call so prompts stay readable and one bad LLM call can't lose
// a huge survivor list. ~10 keeps token budget bounded even with images.
const VERIFY_CHUNK = 10;

/* ---------------------------------- entry --------------------------------- */

export interface LlmMatchDeps {
	/** Resolves an ItemSummary's full detail. Caller controls caching. */
	getDetail: (item: ItemSummary) => Promise<ItemDetail | null>;
}

export async function matchPoolWithLlm(
	candidate: ItemSummary,
	pool: ReadonlyArray<ItemSummary>,
	options: { useImages?: boolean },
	deps: LlmMatchDeps,
): Promise<MatchResponse> {
	const useImages = options.useImages ?? true;

	if (pool.length === 0) {
		return { match: [], reject: [], totals: { match: 0, reject: 0 } };
	}

	const provider = pickProvider();

	// Pass 1 — triage
	const triaged = await triage(provider, candidate, pool, useImages);
	const survivors: { idx: number; item: ItemSummary }[] = [];
	const rejected: MatchedItem[] = [];
	for (let i = 0; i < pool.length; i++) {
		const item = pool[i];
		if (!item) continue;
		const t = triaged.get(i);
		// No triage signal (chunk error after retries, or LLM lost the
		// index in its response) → send to verify. The system prompt
		// declares triage lenient: "borderline cases pass through; the
		// next stage has full details and decides." Treating system
		// failures as silent rejects violated that intent — sold-pool
		// chunks that hit a transient LLM blip would all surface as
		// "Dropped during triage" with no real signal.
		if (!t) {
			survivors.push({ idx: i, item });
		} else if (t.decision === "drop") {
			rejected.push({
				item,
				bucket: "reject",
				reason: t.reason || "Triage drop (no reason given).",
			});
		} else {
			survivors.push({ idx: i, item });
		}
	}

	// Pass 2 — batched deep verify. One call per chunk of survivors keeps
	// the system prompt + candidate detail amortised across N pairs and
	// removes the per-item fanout failure mode. Detail resolution still
	// fans out (cache hits are free, scrapes are I/O bound).
	const candidateDetail = (await deps.getDetail(candidate)) ?? toDetailLike(candidate);
	const survivorsWithDetail = await Promise.all(
		survivors.map(async ({ item }) => ({
			item,
			detail: (await deps.getDetail(item)) ?? toDetailLike(item),
		})),
	);

	// Decision-cache short-circuit: each (candidate, item) pair gets a
	// 30-day cached decision. Hits return from DB without the LLM call;
	// misses go to the verify chunks below. Hosted-only feature — caches
	// only populate when OBSERVATION_ENABLED=1, otherwise the helper
	// returns null and every pair runs verify.
	const cachedResults: { item: ItemSummary; same: boolean; reason: string }[] = [];
	const survivorsToVerify: typeof survivorsWithDetail = [];
	await Promise.all(
		survivorsWithDetail.map(async (entry) => {
			const cached = await getCachedMatchDecision(candidate.itemId, entry.item.itemId).catch(() => null);
			if (cached) {
				cachedResults.push({
					item: entry.item,
					same: cached.decision === "match",
					reason: cached.reason,
				});
			} else {
				survivorsToVerify.push(entry);
			}
		}),
	);

	// Verify chunks run in parallel. Each chunk's LLM call is independent,
	// so sequential `await` was strict latency loss — N survivors → ⌈N/10⌉
	// calls, each ~5-15s wall time. Promise.all collapses that to one
	// chunk's worth of latency. Chunk-level failures are isolated by the
	// per-chunk try/catch so a network blip doesn't lose every survivor.
	const verifyChunks: (typeof survivorsToVerify)[] = [];
	for (let off = 0; off < survivorsToVerify.length; off += VERIFY_CHUNK) {
		verifyChunks.push(survivorsToVerify.slice(off, off + VERIFY_CHUNK));
	}
	const chunkResults = await Promise.all(
		verifyChunks.map(async (chunk) => {
			try {
				const decisions = await verifyBatch(
					provider,
					candidateDetail,
					chunk.map((c) => c.detail),
					useImages,
				);
				return chunk.map((c, i) => {
					const same = decisions[i]?.same ?? false;
					const reason = decisions[i]?.reason ?? "verifier returned no entry";
					// Persist to cache so the next caller skips the LLM. Only
					// real decisions are cached — "verifier returned no entry"
					// signals a malformed LLM response we shouldn't memoise.
					if (decisions[i]) {
						void setCachedMatchDecision(candidate.itemId, c.item.itemId, same ? "match" : "reject", reason);
					}
					return { item: c.item, same, reason };
				});
			} catch (err) {
				const reason = `verify failed: ${(err as Error).message}`;
				return chunk.map((c) => ({ item: c.item, same: false, reason }));
			}
		}),
	);
	const verifyResults = [...cachedResults, ...chunkResults.flat()];

	const match: MatchedItem[] = [];
	for (const r of verifyResults) {
		const labeled: MatchedItem = {
			item: r.item,
			bucket: r.same ? "match" : "reject",
			reason: r.reason,
		};
		if (r.same) match.push(labeled);
		else rejected.push(labeled);
	}

	return {
		match,
		reject: rejected,
		totals: { match: match.length, reject: rejected.length },
	};
}

function toDetailLike(item: ItemSummary): DetailLike {
	return {
		title: item.title,
		condition: item.condition,
		image: item.image,
		price: item.price ?? item.lastSoldPrice,
	};
}

/* --------------------------- JSON parse helpers --------------------------- */

/**
 * Models sometimes wrap JSON in ```json fences or trailing text. Strip
 * the first balanced array/object and parse — defensive but tolerant.
 */
function parseJsonArray<T>(text: string): T[] {
	const m = text.match(/\[[\s\S]*\]/);
	if (!m) return [];
	try {
		const v = JSON.parse(m[0]);
		return Array.isArray(v) ? (v as T[]) : [];
	} catch {
		return [];
	}
}
