/**
 * Single source of truth for the extension's `chrome.storage.local`
 * surface — keys, types, TTLs, read/write helpers. Every cross-context
 * mirror (popup, side panel, content scripts, background SW) reads from
 * here so the wire format never drifts between consumers.
 *
 * Conventions:
 *   - Keys are namespaced under `flipagent_*` so they never collide
 *     with consumers' own page state if storage is ever shared
 *   - TTLs are explicit constants — no inline magic numbers — so the
 *     "how stale is too stale" decision is auditable in one place
 *   - Read helpers tolerate missing entries and return null cleanly;
 *     write helpers preserve the rest of the map (we never blow away
 *     other items on update)
 */

/* --------------------------------- keys --------------------------------- */

export const STORAGE_KEYS = {
	/** Extension config: api key + bridge token + base URL + device name. Managed via shared.ts loadConfig/saveConfig. */
	CONFIG: "flipagent",
	/** Last-observed eBay buyer-session snapshot, mirrored from content-script DOM probes. */
	BUYER_STATE: "flipagent_buyer_state",
	/** Last-observed Planet Express session snapshot. URL-based detection only — PE login is local to the user's browser session. */
	PE_STATE: "flipagent_pe_state",
	/** In-flight buy job picked up from the bridge (one at a time). Managed by background SW. */
	IN_FLIGHT_BUY: "flipagent_in_flight",
	/** Map<itemId, RunningEvalEntry> — currently-running evaluate jobs. Mirrored by evaluate-store; read by popup + side panel for live progress display. */
	RUNNING_EVALS: "flipagent_running_evals",
	/** Map<itemId, PartialOutcomeEntry> — incremental outcome + steps + terminal error, streamed during a run and held while the panel is the user's surface. */
	PARTIAL_OUTCOME: "flipagent_partial_outcome",
	/** Map<itemId, EvalCacheEntry> — completed evaluates within TTL. Avoids re-spending credits when the user re-views the same item. */
	EVAL_CACHE: "flipagent_eval_cache",
	/** Currently-focused itemId in the side panel. Set by background SW on `open-sidepanel` so the iframe can paint with the right item. */
	SIDEPANEL_ITEM_ID: "flipagent_sidepanel_itemId",
	/** Request from the side panel's "Re-evaluate" button — content script picks it up via storage onChanged. */
	EVAL_RERUN_REQUEST: "flipagent_eval_rerun_request",
} as const;

/* -------------------------------- TTLs ---------------------------------- */

/** 24h cache freshness for completed evaluates. Long enough to cover a
 * full browse session without re-charging credits. */
export const EVAL_CACHE_TTL_MS = 24 * 60 * 60_000;
/** Matches `evaluate-engine.STREAM_TIMEOUT_MS` — anything older is a
 * dead run that never wrote a terminal state (killed tab, network drop). */
export const RUNNING_MIRROR_TTL_MS = 6 * 60_000;
/** Soft bound on how many cached entries to keep before evicting LRU.
 * Each entry holds a full EvaluateResponse + trace — bounded so the
 * 10MB chrome.storage.local quota stays comfortable. */
const EVAL_CACHE_MAX = 64;

/* -------------------------------- types --------------------------------- */

export interface BuyerStateSnapshot {
	loggedIn: boolean;
	ebayUserName?: string;
	updatedAt: string;
}

export interface PeStateSnapshot {
	loggedIn: boolean;
	updatedAt: string;
}

export interface EvalCacheEntry {
	result: unknown;
	completedAt: string;
	jobId?: string;
	/** Trace steps the worker emitted on the way to this result. Persisted
	 * so opening a cached evaluate's side panel still renders the full
	 * "Show trace" expander rather than an empty `<ol>`. */
	steps?: unknown[];
}

export interface RunningEvalEntry {
	stepLabel: string;
	jobId?: string;
	startedAt: string;
}

export interface PartialOutcomeEntry {
	outcome: Record<string, unknown>;
	steps: unknown[];
	updatedAt: string;
	/** Set on terminal error transitions so the side panel renders an
	 * error pane (credits_exceeded → upgrade prompt, etc) instead of a
	 * misleading loading skeleton. */
	error?: { message: string; code: string | null; upgradeUrl: string | null };
}

/* ----------------------------- buyer-state ----------------------------- */

export async function readBuyerState(): Promise<BuyerStateSnapshot | null> {
	const stored = await chrome.storage.local.get([STORAGE_KEYS.BUYER_STATE]);
	return (stored[STORAGE_KEYS.BUYER_STATE] ?? null) as BuyerStateSnapshot | null;
}

export async function writeBuyerState(snap: BuyerStateSnapshot): Promise<void> {
	await chrome.storage.local.set({ [STORAGE_KEYS.BUYER_STATE]: snap });
}

export async function readPeState(): Promise<PeStateSnapshot | null> {
	const stored = await chrome.storage.local.get([STORAGE_KEYS.PE_STATE]);
	return (stored[STORAGE_KEYS.PE_STATE] ?? null) as PeStateSnapshot | null;
}

export async function writePeState(snap: PeStateSnapshot): Promise<void> {
	await chrome.storage.local.set({ [STORAGE_KEYS.PE_STATE]: snap });
}

/* ------------------------------ eval cache ------------------------------ */

type EvalCacheMap = Record<string, EvalCacheEntry>;

export async function readEvalCache(itemId: string): Promise<EvalCacheEntry | null> {
	const stored = await chrome.storage.local.get([STORAGE_KEYS.EVAL_CACHE]);
	const map = (stored[STORAGE_KEYS.EVAL_CACHE] ?? {}) as EvalCacheMap;
	const entry = map[itemId];
	if (!entry) return null;
	const ageMs = Date.now() - new Date(entry.completedAt).getTime();
	if (!Number.isFinite(ageMs) || ageMs > EVAL_CACHE_TTL_MS) return null;
	return entry;
}

export async function writeEvalCache(itemId: string, entry: EvalCacheEntry): Promise<void> {
	const stored = await chrome.storage.local.get([STORAGE_KEYS.EVAL_CACHE]);
	const map = { ...((stored[STORAGE_KEYS.EVAL_CACHE] ?? {}) as EvalCacheMap), [itemId]: entry };
	const entries = Object.entries(map);
	if (entries.length > EVAL_CACHE_MAX) {
		// LRU eviction by completedAt — keep the most-recent N. Bounded
		// loop, runs only when the cap is exceeded.
		entries.sort(([, a], [, b]) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
		const trimmed: EvalCacheMap = {};
		for (const [k, v] of entries.slice(0, EVAL_CACHE_MAX)) trimmed[k] = v;
		await chrome.storage.local.set({ [STORAGE_KEYS.EVAL_CACHE]: trimmed });
		return;
	}
	await chrome.storage.local.set({ [STORAGE_KEYS.EVAL_CACHE]: map });
}

/* ----------------------------- running mirror ----------------------------- */

type RunningEvalMap = Record<string, RunningEvalEntry>;

async function readRunningEvals(): Promise<RunningEvalMap> {
	const stored = await chrome.storage.local.get([STORAGE_KEYS.RUNNING_EVALS]);
	return (stored[STORAGE_KEYS.RUNNING_EVALS] ?? {}) as RunningEvalMap;
}

export async function readRunningEval(itemId: string): Promise<RunningEvalEntry | null> {
	const map = await readRunningEvals();
	return map[itemId] ?? null;
}

export async function setRunningEval(itemId: string, patch: Partial<RunningEvalEntry>): Promise<void> {
	const map = await readRunningEvals();
	const had = itemId in map;
	const existing = map[itemId];
	map[itemId] = {
		stepLabel: patch.stepLabel ?? existing?.stepLabel ?? "",
		jobId: patch.jobId ?? existing?.jobId,
		startedAt: had ? (existing?.startedAt ?? new Date().toISOString()) : new Date().toISOString(),
	};
	await chrome.storage.local.set({ [STORAGE_KEYS.RUNNING_EVALS]: map });
}

export async function clearRunningEval(itemId: string): Promise<void> {
	const map = await readRunningEvals();
	if (!(itemId in map)) return;
	delete map[itemId];
	await chrome.storage.local.set({ [STORAGE_KEYS.RUNNING_EVALS]: map });
}

/* ----------------------------- partial outcome ----------------------------- */

type PartialOutcomeMap = Record<string, PartialOutcomeEntry>;

async function readPartialOutcomes(): Promise<PartialOutcomeMap> {
	const stored = await chrome.storage.local.get([STORAGE_KEYS.PARTIAL_OUTCOME]);
	return (stored[STORAGE_KEYS.PARTIAL_OUTCOME] ?? {}) as PartialOutcomeMap;
}

export async function writePartialOutcome(
	itemId: string,
	outcome: Record<string, unknown>,
	steps: unknown[],
): Promise<void> {
	const map = await readPartialOutcomes();
	map[itemId] = {
		outcome: { ...outcome },
		steps: steps.slice(),
		updatedAt: new Date().toISOString(),
	};
	await chrome.storage.local.set({ [STORAGE_KEYS.PARTIAL_OUTCOME]: map });
}

export async function writePartialError(
	itemId: string,
	error: { message: string; code: string | null; upgradeUrl: string | null },
): Promise<void> {
	const map = await readPartialOutcomes();
	const existing = map[itemId];
	map[itemId] = {
		outcome: existing?.outcome ?? {},
		steps: existing?.steps ?? [],
		updatedAt: new Date().toISOString(),
		error,
	};
	await chrome.storage.local.set({ [STORAGE_KEYS.PARTIAL_OUTCOME]: map });
}

export async function clearPartialOutcome(itemId: string): Promise<void> {
	const map = await readPartialOutcomes();
	if (!(itemId in map)) return;
	delete map[itemId];
	await chrome.storage.local.set({ [STORAGE_KEYS.PARTIAL_OUTCOME]: map });
}
