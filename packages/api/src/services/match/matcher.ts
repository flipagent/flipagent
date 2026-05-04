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
 * Used by /v1/evaluate (single seed). No skip-verify mode. Detail
 * resolution is a `port` (`DetailFetcher`) — the caller supplies an
 * adapter (typically `detailFetcherFor(apiKey)` from the listings
 * service) so the matcher stays decoupled from eBay transport, auth,
 * and tier-quota concerns.
 */

import type { ItemDetail, ItemSummary } from "@flipagent/types/ebay/buy";
import { getCachedMatchDecision, setCachedMatchDecision } from "./decision-cache.js";
import { type LlmContent, type LlmProvider, pickProvider } from "./llm/index.js";
import type { MatchedItem, MatchResponse } from "./types.js";

const TRACE = process.env.MATCHER_TRACE === "1";
const traceLog = (msg: string): void => {
	if (TRACE) console.log(`[matcher] ${msg}`);
};

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

// Prompts moved to ./prompts/{base,overlays/*}.ts so per-category rules
// (sneaker size discipline, watch SKU bare-model rule, graded-card grade
// matching, etc.) can be added/edited without touching this file. The
// registry in prompts/index.ts maps eBay categoryId → overlay; the
// candidate's categoryIdPath drives which overlay fires.
import { pickVerifyOverlayName, pickVerifyPrompt, SYSTEM_TRIAGE } from "./prompts/index.js";

type RejectionCat = "wrong_product" | "bundle_or_lot" | "off_condition" | "other";

const REJECTION_CATS: ReadonlySet<string> = new Set(["wrong_product", "bundle_or_lot", "off_condition", "other"]);

function coerceCategory(raw: unknown): RejectionCat | undefined {
	if (typeof raw !== "string") return undefined;
	return REJECTION_CATS.has(raw) ? (raw as RejectionCat) : "other";
}

interface TriageItem {
	i: number;
	decision: "keep" | "drop";
	reason: string;
	category?: RejectionCat;
}

interface VerifyResult {
	same: boolean;
	reason: string;
	category?: RejectionCat;
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
const TRIAGE_CHUNK = process.env.TRIAGE_CHUNK ? Number.parseInt(process.env.TRIAGE_CHUNK, 10) : 25;

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

	const triageStart = performance.now();
	traceLog(`triage start: pool=${pool.length} chunks=${chunks.length} chunkSize=${TRIAGE_CHUNK}`);
	const chunkStarts = chunks.map(() => performance.now());
	const results = await Promise.allSettled(
		chunks.map((chunk, i) =>
			triageChunkWithRetry(provider, candidate, chunk, useImages).then((r) => {
				traceLog(
					`  triage chunk ${i} done in ${Math.round(performance.now() - chunkStarts[i]!)}ms (${chunk.length} items)`,
				);
				return r;
			}),
		),
	);
	traceLog(`triage total: ${Math.round(performance.now() - triageStart)}ms`);

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
	/**
	 * Pipe-joined eBay category id hierarchy (`"293|15032|9355"` for an
	 * iPhone). Drives `pickVerifyPrompt()` overlay selection — see
	 * `prompts/index.ts`. Not surfaced in the LLM prompt itself; it's
	 * routing metadata.
	 */
	categoryIdPath?: string;
	localizedAspects?: ReadonlyArray<{ name: string; value: string }>;
	image?: { imageUrl: string };
	price?: { value: string; currency: string };
	/**
	 * eBay catalog product id. Same `epid` across every listing of the same
	 * SKU, so the matcher can short-circuit: when CANDIDATE and ITEM share an
	 * epid, eBay considers them the same catalog product — no LLM needed.
	 * Browse REST surfaces it; scrape extracts it from the `/p/{epid}` link.
	 */
	epid?: string;
	/** Manufacturer Part Number — variant disambiguator when title is silent. */
	mpn?: string;
	/** >1 means the listing covers multiple physical units (lot/bundle). */
	lotSize?: number;
	/** Long-form seller condition note — distinguishes fulfilment notes from defects. */
	conditionDescription?: string;
	/** Structured grade/cert rows (PSA grade, BGS rating, certification number). */
	conditionDescriptors?: ReadonlyArray<{ name?: string; values?: ReadonlyArray<{ content?: string }> }>;
	/**
	 * Strikethrough/list-price + discount metadata. Strong fake-listing signal:
	 * a brand-new iPhone "$400 (was $1199, 67% off)" is almost always a replica.
	 */
	marketingPrice?: {
		originalPrice?: { value: string; currency?: string };
		discountPercentage?: string;
	};
	/**
	 * Short-form description from the listing's `<meta name="description">`
	 * tag — eBay populates it from the seller's first paragraph. Often spells
	 * out STORAGE / COLOR / CARRIER even when the title is silent. Critical
	 * for variant confirmation when the title omits an axis.
	 */
	shortDescription?: string;
	/**
	 * Carried through so verified items can splice dates back into the
	 * returned ItemSummary, letting downstream `enrichWithDuration`
	 * short-circuit. Not used by `summariseDetail` (LLM doesn't need
	 * dates for product disambiguation).
	 */
	itemCreationDate?: string;
	itemEndDate?: string;
	/**
	 * Authenticity Guarantee block — Browse REST emits an object
	 * (`{ description, termsWebUrl }`) on listings routed through
	 * third-party authentication (sneakers, handbags, watches, trading
	 * cards, fine jewelry). Detail-only on REST; the matcher already has
	 * the detail in hand from the verify pass and splices a derived
	 * boolean onto the matched ItemSummary so the playground / extension
	 * can render an "AG" badge on every comp row that qualifies (premium
	 * signal for resellers; lower dispute risk).
	 */
	authenticityGuarantee?: { description?: string; termsWebUrl?: string };
	qualifiedPrograms?: ReadonlyArray<string>;
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
	if (d.epid) lines.push(`epid: ${d.epid}`);
	if (d.mpn) lines.push(`mpn: ${d.mpn}`);
	if (d.condition) lines.push(`condition: ${d.condition}`);
	if (d.conditionDescription && d.conditionDescription.toLowerCase() !== d.condition?.toLowerCase()) {
		lines.push(`conditionNote: ${d.conditionDescription.slice(0, 240)}`);
	}
	if (d.conditionDescriptors && d.conditionDescriptors.length > 0) {
		// Structured grade rows (PSA grade, BGS rating, cert number). One line each.
		const flat = d.conditionDescriptors
			.map(
				(row) =>
					`${row.name ?? "?"}: ${(row.values ?? [])
						.map((v) => v.content ?? "")
						.filter(Boolean)
						.join(", ")}`,
			)
			.join(" | ");
		lines.push(`grade: ${flat}`);
	}
	if (typeof d.lotSize === "number" && d.lotSize > 1) lines.push(`lotSize: ${d.lotSize} units`);
	if (d.categoryPath) lines.push(`category: ${d.categoryPath}`);
	if (d.price) lines.push(`price: $${d.price.value}`);
	if (d.marketingPrice?.originalPrice?.value) {
		const op = d.marketingPrice.originalPrice.value;
		const pct = d.marketingPrice.discountPercentage ? ` (${d.marketingPrice.discountPercentage}% off)` : "";
		lines.push(`marketingPrice: was $${op}${pct}`);
	}
	if (d.localizedAspects && d.localizedAspects.length > 0) {
		lines.push("aspects:");
		for (const a of d.localizedAspects) lines.push(`  - ${a.name}: ${a.value}`);
	}
	// shortDescription often spells out STORAGE / COLOR / CARRIER even when
	// the title is silent — pulled from the seller's first paragraph by eBay.
	// Cap at 300 chars so the prompt stays compact.
	if (d.shortDescription) {
		lines.push(`description: ${d.shortDescription.slice(0, 300)}`);
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

	// NOTE: prior versions short-circuited to MATCH on shared epid. That was
	// WRONG. eBay's catalog product id (`epid`) is granular at the
	// model+capacity level for many categories — e.g. iPhone 15 Pro Max
	// 256GB across ALL colorways (Natural / Black / Blue / White / even
	// scammy "Beige TikTok-installed") share epid=9062763667. So a shared
	// epid is a same-catalog-product signal, NOT a same-variant signal.
	// We now feed epid into the LLM prompt (via summariseDetail) and let
	// it combine with title/aspects/variations to decide. The shortcut
	// stays available for future categories that genuinely have variant-
	// level epids (graded cards, sealed media), but only after we've
	// validated per-category that epid == variant for them.
	const out: VerifyResult[] = new Array(items.length);
	const llmIndices: number[] = [];
	for (let i = 0; i < items.length; i++) llmIndices.push(i);
	if (llmIndices.length === 0) return out;

	const user: LlmContent[] = [];
	if (useImages && candidate.image?.imageUrl) {
		user.push({ type: "text", text: "CANDIDATE IMAGE:" });
		user.push({ type: "image", imageUrl: candidate.image.imageUrl });
	}
	user.push({ type: "text", text: `CANDIDATE\n${summariseDetail(candidate)}` });
	user.push({ type: "text", text: `ITEMS (${llmIndices.length}):` });
	// Renumber for the LLM (`[0]`..`[N-1]` over the items we actually send),
	// then map the response back to original indices via `llmIndices`.
	for (let n = 0; n < llmIndices.length; n++) {
		const i = llmIndices[n]!;
		const it = items[i];
		if (!it) continue;
		if (useImages && it.image?.imageUrl) {
			user.push({ type: "text", text: `[${n}] IMAGE:` });
			user.push({ type: "image", imageUrl: it.image.imageUrl });
		}
		user.push({ type: "text", text: `[${n}]\n${summariseDetail(it)}` });
	}

	// Resolve the verifier prompt for this candidate's category.
	// Unknown categories fall back to the base prompt; known categories
	// (smartphones / wristwatches / sneakers / graded cards / consoles)
	// get base + category-specific overlay. See prompts/index.ts.
	const verifySystem = pickVerifyPrompt(candidate.categoryIdPath);
	const overlayName = pickVerifyOverlayName(candidate.categoryIdPath);
	if (overlayName) traceLog(`verify overlay=${overlayName} (path=${candidate.categoryIdPath})`);

	const text = await provider.complete({
		system: verifySystem,
		user,
		// Generous: thinking-mode models (Gemini 2.5+, GPT-5) eat the same
		// budget for chain-of-thought, so a tight cap silently truncates the
		// JSON. ~256/item leaves headroom even with full thinking.
		maxTokens: 512 + llmIndices.length * 256,
	});
	const arr = parseJsonArray<VerifyEntry>(text);
	// Backfill default-reject for items not handled by either path.
	for (let i = 0; i < items.length; i++) {
		if (!out[i]) out[i] = { same: false, reason: "verifier returned no entry", category: "other" as const };
	}
	for (const r of arr) {
		// `r.i` is the LLM-side index (0..llmIndices.length-1); map back to
		// the items[] index via llmIndices[].
		if (typeof r.i === "number" && r.i >= 0 && r.i < llmIndices.length) {
			const origIdx = llmIndices[r.i]!;
			const same = !!r.same;
			const entry: VerifyResult = { same, reason: r.reason ?? "" };
			if (!same) entry.category = coerceCategory(r.category) ?? "other";
			out[origIdx] = entry;
		}
	}
	return out;
}

// Verify pass: 1 item per LLM call. Empirically ~+3% mean F1 over chunk=10
// (iPhone +26%, Switch +11%) at the same model — per-item attention focus
// matters more for accuracy than batch amortisation. Wall time barely moves
// because chunks run in parallel through the existing semaphore. Override
// via VERIFY_CHUNK env when benchmarking the cost/accuracy tradeoff.
const VERIFY_CHUNK = process.env.VERIFY_CHUNK ? Number.parseInt(process.env.VERIFY_CHUNK, 10) : 1;

/* ---------------------------------- entry --------------------------------- */

export async function matchPoolWithLlm(
	candidate: ItemSummary,
	pool: ReadonlyArray<ItemSummary>,
	options: { useImages?: boolean; triageProvider?: LlmProvider; verifyProvider?: LlmProvider },
	fetchDetail: DetailFetcher,
): Promise<MatchResponse> {
	const useImages = options.useImages ?? true;

	if (pool.length === 0) {
		return { match: [], reject: [], totals: { match: 0, reject: 0 } };
	}

	const defaultProvider = options.triageProvider || options.verifyProvider ? null : pickProvider();
	const triageProvider = options.triageProvider ?? defaultProvider!;
	const verifyProvider = options.verifyProvider ?? defaultProvider!;
	traceLog(
		`providers: triage=${triageProvider.name}/${triageProvider.model} verify=${verifyProvider.name}/${verifyProvider.model}`,
	);

	// ─── Pass 1: triage ──────────────────────────────────────────────────
	// Lenient text-only filter that drops obviously different products
	// using only title + price hints. Cheap (no detail fetch). Chunk
	// failures pass through to verify (declared behaviour: borderline
	// cases get the rich detail in pass 2).
	const triaged = await triage(triageProvider, candidate, pool, useImages);
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
				category: coerceCategory(t.category) ?? "other",
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
	const enrichStart = performance.now();
	traceLog(`enrich start: survivors=${survivors.length}`);
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
	traceLog(`enrich done: ${Math.round(performance.now() - enrichStart)}ms`);

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
			const isMatch = cached.decision === "match";
			const m: MatchedItem = {
				item: entry.item,
				bucket: isMatch ? "match" : "reject",
				reason: cached.reason || "Cached decision.",
				// The decision-cache predates the category field; cached rejects
				// surface as "other" until they're re-verified at next miss.
				...(isMatch ? {} : { category: "other" as const }),
			};
			(isMatch ? cachedMatched : cachedRejected).push(m);
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
	const verifyStart = performance.now();
	traceLog(
		`verify start: toVerify=${survivorsToVerify.length} chunks=${verifyChunks.length} chunkSize=${VERIFY_CHUNK} cached=${cachedMatched.length + cachedRejected.length}`,
	);
	const verifyChunkStarts = verifyChunks.map(() => performance.now());
	const chunkResults = await Promise.all(
		verifyChunks.map(async (chunk, ci) => {
			try {
				const decisions = await verifyBatch(
					verifyProvider,
					candidateDetail,
					chunk.map((c) => c.detail),
					useImages,
				);
				traceLog(
					`  verify chunk ${ci} done in ${Math.round(performance.now() - verifyChunkStarts[ci]!)}ms (${chunk.length} items)`,
				);
				return chunk.map((c, i) => {
					const same = decisions[i]?.same ?? false;
					const reason = decisions[i]?.reason ?? "verifier returned no entry";
					const category: RejectionCat | undefined = same ? undefined : (decisions[i]?.category ?? "other");
					// Persist to cache so the next caller skips the LLM. Only
					// real decisions are cached — "verifier returned no entry"
					// signals a malformed LLM response we shouldn't memoise.
					if (decisions[i]) {
						void setCachedMatchDecision(candidate.itemId, c.item.itemId, same ? "match" : "reject", reason);
					}
					return { item: c.item, same, reason, category };
				});
			} catch (err) {
				traceLog(
					`  verify chunk ${ci} FAILED in ${Math.round(performance.now() - verifyChunkStarts[ci]!)}ms: ${(err as Error).message}`,
				);
				const reason = `verify failed: ${(err as Error).message}`;
				return chunk.map((c) => ({
					item: c.item,
					same: false,
					reason,
					category: "other" as RejectionCat,
				}));
			}
		}),
	);
	traceLog(`verify total: ${Math.round(performance.now() - verifyStart)}ms`);
	const verifyMatched: MatchedItem[] = [];
	const verifyRejected: MatchedItem[] = [];
	for (const r of chunkResults.flat()) {
		const labeled: MatchedItem = {
			item: r.item, // dates already spliced via survivorsEnriched
			bucket: r.same ? "match" : "reject",
			reason: r.reason,
			...(r.same ? {} : { category: r.category ?? "other" }),
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
 * Splice detail-only fields (dates, Authenticity Guarantee, qualified
 * programs) from a fetched detail back into the summary. Browse REST
 * Search emits none of these on summary cards, but the matcher's
 * verify pass already fetched the detail for every candidate — so we
 * piggy-back, letting downstream consumers (`enrichWithDuration`, the
 * playground / extension matches list) read them off `ItemSummary`
 * without a separate detail cache hit. Other detail fields (brand /
 * gtin / aspects) stay in the detail cache — callers who need them
 * fetch on demand.
 */
function spliceDateFields(item: ItemSummary, detail: DetailLike): ItemSummary {
	const dates = !!(detail.itemCreationDate || detail.itemEndDate);
	const ag = !!detail.authenticityGuarantee || (detail.qualifiedPrograms?.length ?? 0) > 0;
	if (!dates && !ag) return item;
	// Cast widens ItemSummary with the two flipagent-side fields — eBay's
	// strict ItemSummary schema doesn't carry them (Browse REST is
	// detail-only for AG), but downstream consumers (`EvaluateResponse`
	// pools → playground / extension) read them off the JSON payload.
	const next = { ...item } as ItemSummary & {
		authenticityGuarantee?: boolean;
		qualifiedPrograms?: string[];
	};
	if (dates) {
		if (!item.itemCreationDate && detail.itemCreationDate) next.itemCreationDate = detail.itemCreationDate;
		if (!item.itemEndDate && detail.itemEndDate) next.itemEndDate = detail.itemEndDate;
	}
	if (ag) {
		if (detail.authenticityGuarantee) next.authenticityGuarantee = true;
		if (detail.qualifiedPrograms?.length) next.qualifiedPrograms = [...detail.qualifiedPrograms];
	}
	return next;
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
