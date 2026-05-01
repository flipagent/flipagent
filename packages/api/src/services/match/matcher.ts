/**
 * Two-pass LLM product matcher. Self-contained — provider-agnostic via
 * `pickProvider()`, fetches detail through the shared cached path, and
 * memoises pair decisions in the 30-day decision cache.
 *
 *   Pass 1 — batch triage. One model call per chunk-of-25 sees the
 *   candidate and pool items' titles / conditions / prices (and
 *   thumbnail images when `useImages`). Lenient: drops only obviously
 *   different products.
 *
 *   Decision cache check. Each surviving (candidate, item) pair is
 *   looked up in the 30-day decision cache. Hits skip both detail
 *   fetch and verify LLM. The cache check happens BEFORE any detail
 *   fetch so a warm cache costs zero Oxylabs scrapes.
 *
 *   Pass 2 — deep verify. For un-cached survivors only: fetch full
 *   ItemDetail (brand, gtin, categoryPath, localizedAspects, full
 *   image set) and send candidate + chunk-of-10 survivors to one LLM
 *   call. Strict: rejects different reference / variant / condition.
 *   Decisions are written back to the cache.
 *
 * Same shape used by /v1/evaluate (single seed) and /v1/discover
 * (per-cluster). No skip-verify mode. Detail resolution is a `port`
 * (`DetailFetcher`) — the caller supplies an adapter (typically
 * `detailFetcherFor(apiKey)` from the listings service) so the matcher
 * stays decoupled from eBay transport, auth, and tier-quota concerns.
 */

import type { ItemDetail, ItemSummary } from "@flipagent/types/ebay/buy";
import { getCachedMatchDecision, setCachedMatchDecision } from "./decision-cache.js";
import { type LlmContent, type LlmProvider, pickProvider } from "./llm/index.js";
import type { MatchedItem, MatchResponse } from "./types.js";

/**
 * Resolve an `ItemSummary` to its full `ItemDetail`. Returns null when
 * the item has no resolvable id or the upstream couldn't render. Pure
 * port: matcher knows nothing about eBay transport, auth, caching, or
 * tier limits — caller's adapter (`detailFetcherFor(apiKey)`) owns all
 * of that. Cache-friendly: the standard adapter delegates to the 4h
 * detail cache so repeat calls are free.
 */
export type DetailFetcher = (item: ItemSummary) => Promise<ItemDetail | null>;

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

MULTI-VARIATION LISTINGS (sneakers, clothes, bags): an item or candidate may carry a "variations (N SKUs in this listing)" block — one URL bundling several sizes/colours, each with its own price. When the CANDIDATE's variation is product-defining (its localizedAspects state Size: US M8, or its title implies Size 8), an ITEM that's a multi-variation listing is a match ONLY if one of its SKUs matches the candidate's variation at a comparable price tier. If none of the item's SKUs are the candidate's size (e.g. candidate is "Size: US M8" but the item lists only "PS 3Y" + "GS 5Y"), reject — even when title and brand match. When BOTH candidate and item are multi-variation parents that share the same SKU set, treat as same product (the buyer can pick the same variation on either listing). Use price as a tiebreaker only when the variation aspects are ambiguous: an item priced near one specific SKU is presumptively that SKU.

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
	/**
	 * Carried through so verified items can splice dates back into the
	 * returned ItemSummary, letting downstream `enrichWithDuration`
	 * short-circuit. Not used by `summariseDetail` (LLM doesn't need
	 * dates for product disambiguation).
	 */
	itemCreationDate?: string;
	itemEndDate?: string;
	/**
	 * Multi-SKU variations parsed from the page's MSKU model. Present on
	 * any sneaker / clothes / bag listing where one URL covers multiple
	 * sizes or colours. The matcher exposes the full list to the LLM so
	 * it can decide whether the SEED's specific SKU is among the
	 * candidate's SKUs at a comparable price tier — a multi-variation
	 * candidate isn't automatically a match just because the title is
	 * similar; it depends on whether the seed's variation actually
	 * exists inside it.
	 */
	variations?: ReadonlyArray<{
		variationId: string;
		priceCents: number | null;
		currency: string;
		aspects: ReadonlyArray<{ name: string; value: string }>;
	}>;
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
	// Multi-SKU listings: list every variation as one line — `axis: value`
	// for each axis, plus the variation's own price. Lets the LLM pick the
	// SKU the seed actually matches (by price tier or stated variation
	// aspects), and reject when the seed's variation isn't represented.
	if (d.variations && d.variations.length > 0) {
		lines.push(`variations (${d.variations.length} SKUs in this listing):`);
		for (const v of d.variations) {
			const aspectStr = v.aspects.map((a) => `${a.name}: ${a.value}`).join(", ");
			const priceStr = v.priceCents != null ? `$${(v.priceCents / 100).toFixed(2)}` : "n/a";
			lines.push(`  - ${aspectStr || "(no aspect)"} — ${priceStr}`);
		}
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

export async function matchPoolWithLlm(
	candidate: ItemSummary,
	pool: ReadonlyArray<ItemSummary>,
	options: { useImages?: boolean },
	fetchDetail: DetailFetcher,
): Promise<MatchResponse> {
	const useImages = options.useImages ?? true;

	if (pool.length === 0) {
		return { match: [], reject: [], totals: { match: 0, reject: 0 } };
	}

	const provider = pickProvider();

	// ─── Pass 1: triage ──────────────────────────────────────────────────
	// Lenient text-only filter that drops obviously different products
	// using only title + price hints. Cheap (no detail fetch). Chunk
	// failures pass through to verify (declared behaviour: borderline
	// cases get the rich detail in pass 2).
	const triaged = await triage(provider, candidate, pool, useImages);
	const survivors: { idx: number; item: ItemSummary }[] = [];
	const rejected: MatchedItem[] = [];
	for (let i = 0; i < pool.length; i++) {
		const item = pool[i];
		if (!item) continue;
		const t = triaged.get(i);
		if (!t || t.decision !== "drop") {
			survivors.push({ idx: i, item });
		} else {
			rejected.push({
				item,
				bucket: "reject",
				reason: t.reason || "Triage drop (no reason given).",
			});
		}
	}

	if (survivors.length === 0) {
		return { match: [], reject: rejected, totals: { match: 0, reject: rejected.length } };
	}

	// ─── Detail enrichment ───────────────────────────────────────────────
	// Fetch detail for ALL triage survivors and splice
	// `itemCreationDate` / `itemEndDate` back onto the summary. This step
	// runs unconditionally (regardless of the (candidate, item) match-
	// decision cache below) because:
	//
	//   1. The match itself is fundamentally a detail-vs-detail
	//      comparison — title triage is a coarse pre-filter, not the
	//      decision. Items that survive triage MUST have detail before
	//      we trust them as same-product candidates.
	//   2. Hazard / duration math downstream (`computeDurationDays` in
	//      services/evaluate/adapter) needs creation + end dates.
	//      Sold-search cards carry `lastSoldDate` only; creation date
	//      lives on the detail page's SEMANTIC_DATA. Without this fetch,
	//      `meanDaysToSell` permanently nulls for warm caches where pass
	//      2 used to do the work as a side effect.
	//
	// `fetchDetail` is wired through 4h `withCache` so warm runs are
	// near-instant. Cold runs match the cost we'd have paid when pass 2
	// fetched detail for every uncached survivor.
	const candidateDetail = (await fetchDetail(candidate)) ?? toDetailLike(candidate);
	const survivorsEnriched = await Promise.all(
		survivors.map(async (entry) => {
			const detail = (await fetchDetail(entry.item)) ?? toDetailLike(entry.item);
			return {
				idx: entry.idx,
				item: spliceDateFields(entry.item, detail),
				detail,
			};
		}),
	);

	// ─── Decision cache lookup ───────────────────────────────────────────
	// Saves the *LLM verify* cost on warm pairs (the expensive part).
	// Detail is already fetched + spliced above, so cached items still
	// carry duration data downstream — the cache miss/hit only changes
	// whether we re-run the verify LLM, not whether we have detail.
	const cachedMatched: MatchedItem[] = [];
	const cachedRejected: MatchedItem[] = [];
	const survivorsToVerify: typeof survivorsEnriched = [];
	await Promise.all(
		survivorsEnriched.map(async (entry) => {
			const cached = await getCachedMatchDecision(candidate.itemId, entry.item.itemId).catch(() => null);
			if (!cached) {
				survivorsToVerify.push(entry);
				return;
			}
			const m: MatchedItem = {
				item: entry.item,
				bucket: cached.decision === "match" ? "match" : "reject",
				reason: cached.reason || "Cached decision.",
			};
			(cached.decision === "match" ? cachedMatched : cachedRejected).push(m);
		}),
	);

	if (survivorsToVerify.length === 0) {
		// Every survivor decided by triage + cache. Detail still fetched +
		// spliced, so `match[]` items carry creation / end dates for the
		// duration math.
		return {
			match: cachedMatched,
			reject: [...rejected, ...cachedRejected],
			totals: { match: cachedMatched.length, reject: rejected.length + cachedRejected.length },
		};
	}

	// ─── Pass 2: deep verify LLM ─────────────────────────────────────────
	// Reuses the already-fetched details — no double round-trip. Verify
	// chunks run in parallel. Each chunk's LLM call is independent, so
	// sequential `await` was strict latency loss — N survivors → ⌈N/10⌉
	// calls, each ~5-15s wall time. Chunk-level failures are isolated
	// per-chunk so a network blip doesn't lose every survivor.
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
	const verifyMatched: MatchedItem[] = [];
	const verifyRejected: MatchedItem[] = [];
	for (const r of chunkResults.flat()) {
		const labeled: MatchedItem = {
			item: r.item, // dates already spliced via survivorsEnriched
			bucket: r.same ? "match" : "reject",
			reason: r.reason,
		};
		(r.same ? verifyMatched : verifyRejected).push(labeled);
	}

	return {
		match: [...cachedMatched, ...verifyMatched],
		reject: [...rejected, ...cachedRejected, ...verifyRejected],
		totals: {
			match: cachedMatched.length + verifyMatched.length,
			reject: rejected.length + cachedRejected.length + verifyRejected.length,
		},
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

/**
 * Splice `itemCreationDate` / `itemEndDate` from a fetched detail back
 * into the summary, ONLY if the summary lacked them. Lets downstream
 * `enrichWithDuration` short-circuit on items the verify pass already
 * fetched detail for, eliminating a round-trip through the 4h detail
 * cache. Other detail fields (brand / gtin / aspects) stay in the
 * detail cache — callers who need them fetch on demand.
 */
function spliceDateFields(item: ItemSummary, detail: DetailLike): ItemSummary {
	if (!detail.itemCreationDate && !detail.itemEndDate) return item;
	if (item.itemCreationDate && item.itemEndDate) return item;
	return {
		...item,
		itemCreationDate: item.itemCreationDate ?? detail.itemCreationDate,
		itemEndDate: item.itemEndDate ?? detail.itemEndDate,
	};
}

/* --------------------------- JSON parse helpers --------------------------- */

/**
 * Tolerant JSON-array extractor. Models add markdown fences, prose
 * preambles, and — most painfully — get cut off mid-stream when the
 * `maxTokens` budget runs out, leaving an unclosed array. We recover
 * what we can:
 *
 *   1. Strip ```json / ``` fences if present.
 *   2. Try a clean parse on the first balanced `[...]` bracket.
 *   3. If that fails (truncation: trailing comma, half-written object,
 *      missing `]`), walk the text and extract every COMPLETE top-level
 *      `{...}` object via brace-depth tracking. Skip the partial last
 *      one. Returns those parsed objects.
 *
 * This means a triage / verify call that runs out of tokens mid-output
 * still surfaces the entries the model managed to commit, instead of
 * returning empty and forcing a retry that often hits the same cap.
 */
export { parseJsonArray as __parseJsonArrayForTest };
export { summariseDetail as __summariseDetailForTest };
function parseJsonArray<T>(text: string): T[] {
	let body = text.trim();
	const fence = body.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
	if (fence) body = fence[1] ?? body;

	const arrMatch = body.match(/\[[\s\S]*\]/);
	if (arrMatch) {
		try {
			const v = JSON.parse(arrMatch[0]);
			if (Array.isArray(v)) return v as T[];
		} catch {
			// Fall through to object-by-object recovery below.
		}
	}

	const start = body.indexOf("[");
	if (start === -1) return [];
	const out: T[] = [];
	let depth = 0;
	let inString = false;
	let escaped = false;
	let objStart = -1;
	for (let i = start + 1; i < body.length; i++) {
		const ch = body[i];
		if (inString) {
			if (escaped) escaped = false;
			else if (ch === "\\") escaped = true;
			else if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') {
			inString = true;
			continue;
		}
		if (ch === "{") {
			if (depth === 0) objStart = i;
			depth++;
		} else if (ch === "}") {
			depth--;
			if (depth === 0 && objStart !== -1) {
				try {
					out.push(JSON.parse(body.slice(objStart, i + 1)) as T);
				} catch {
					// Skip malformed object, keep going.
				}
				objStart = -1;
			}
		}
	}
	return out;
}
