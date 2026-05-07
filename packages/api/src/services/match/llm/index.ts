/**
 * LLM provider abstraction for the same-product matcher.
 *
 * Role split:
 *   - `anthropic.ts` / `openai.ts` / `google.ts` — SDK adapters. Each
 *     normalises its vendor SDK to the `LlmProvider` interface. Pure
 *     glue; no concurrency, no retry, no policy.
 *   - This file (`pickProvider`) — provider selection + the two
 *     cross-cutting concerns that should behave identically regardless
 *     of which SDK is underneath: a process-wide concurrency cap
 *     (semaphore) and a transient-failure retry loop. Mirrors the
 *     scraper-side pattern in `oxylabs.ts` so both upstreams have the
 *     same operational shape.
 *
 * Selection is env-driven:
 *
 *   LLM_PROVIDER=anthropic|openai|google   explicit pick (wins).
 *   otherwise                              first key set, in order:
 *                                          anthropic → openai → google.
 *
 * Models are configurable per provider (`ANTHROPIC_MODEL`, `OPENAI_MODEL`,
 * `GOOGLE_MODEL`) with vision-capable defaults.
 */

import { config } from "../../../config.js";
import { Semaphore } from "../../../utils/semaphore.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createGoogleProvider } from "./google.js";
import { createOpenAiProvider } from "./openai.js";

export type LlmProviderName = "anthropic" | "openai" | "google";

export interface LlmContent {
	type: "text" | "image";
	text?: string;
	imageUrl?: string;
}

export interface LlmRequest {
	system: string;
	user: LlmContent[];
	maxTokens: number;
}

export interface LlmProvider {
	name: LlmProviderName;
	model: string;
	/** Returns the model's raw text response. Caller parses JSON. */
	complete(req: LlmRequest): Promise<string>;
}

/**
 * Per-process LLM concurrency cap. The matcher fans out one LLM call
 * per verify item (`VERIFY_CHUNK=1` default in matcher.ts); without
 * this gate they all hit the provider at once and the slowest queue on
 * the provider side.
 *
 * Default 16 — empirically the sweet spot at our current Google Gemini
 * paid tier (1000 RPM). At 8 the longest-tail dataset took 50-100s wall
 * vs ~10s at 16; going to 32 added no further wall-time gain (rate
 * limits start to bite). Override with `LLM_MAX_CONCURRENT` env when a
 * provider's tier dictates a different ceiling (Anthropic tier 1: ~4,
 * OpenAI tier 1: 8-16).
 */
const llmSemaphore = new Semaphore(config.LLM_MAX_CONCURRENT ?? 16);

/**
 * Transient LLM failures (rate-limit, brief 5xx) are common enough that
 * letting them surface drops verify chunks and silently shrinks the
 * matched pool — same failure mode the scraper retry guards. Anthropic
 * and OpenAI SDKs already retry 2x internally; Google's does not. We add
 * exactly **one** outer retry as the last safety net:
 *
 *   - Caller error already exhausted SDK retries → we get one more shot
 *     at a 500ms gap, which sometimes catches a blip that resolved
 *     between the SDK's final attempt and ours.
 *   - Google has no internal retry, so this is its only safety net.
 *
 * Why not more? Anthropic overloaded (529) windows last seconds to
 * minutes — a second outer retry at 1.5s wouldn't clear them, just
 * extend the failure tail. matchPool already has graceful fallback
 * (triage failure keeps all candidates lenient; verify failure marks
 * the chunk rejected) so a propagated transient doesn't break the
 * user-visible flow. Stacking more retries here would only add latency
 * to calls that were going to fail anyway, with multiplicative effect
 * on top of the SDK's own retries (max 6 attempts on Anthropic/OpenAI).
 *
 * Anything that throws after the one retry is either non-transient or a
 * sustained outage — propagate so callers can fall back.
 */
const MAX_LLM_ATTEMPTS = 2;

async function callWithRetry(provider: LlmProvider, req: LlmRequest): Promise<string> {
	let lastErr: unknown;
	for (let attempt = 0; attempt < MAX_LLM_ATTEMPTS; attempt++) {
		try {
			return await provider.complete(req);
		} catch (err) {
			lastErr = err;
			if (!isTransientLlmError(err) || attempt === MAX_LLM_ATTEMPTS - 1) {
				throw err;
			}
			await new Promise((r) => setTimeout(r, 500));
		}
	}
	throw lastErr;
}

/** Exported for testing. True iff the error matches a transient LLM-side failure that should be retried. */
export function isTransientLlmError(err: unknown): boolean {
	if (typeof err !== "object" || err === null) return false;
	const e = err as { status?: unknown; statusCode?: unknown; code?: unknown; name?: unknown; message?: unknown };
	const status = typeof e.status === "number" ? e.status : typeof e.statusCode === "number" ? e.statusCode : null;
	if (status != null && (status === 408 || status === 425 || status === 429 || status >= 500)) return true;
	const name = typeof e.name === "string" ? e.name : "";
	if (/RateLimit|Overloaded|Timeout|InternalServer|ServiceUnavailable/i.test(name)) return true;
	const code = typeof e.code === "string" ? e.code : "";
	if (/^(ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR_)/i.test(code)) return true;
	const msg = typeof e.message === "string" ? e.message : "";
	return /overloaded|rate.?limit|timed? ?out|temporarily unavailable|try again/i.test(msg);
}

/**
 * Resolve which provider to use. Throws if none configured — caller
 * surfaces 503 to the client. The returned provider's `complete()` runs
 * inside the global LLM semaphore AND the transient-failure retry
 * loop, so callers don't need to coordinate either themselves.
 */
export function pickProvider(): LlmProvider {
	const explicit = config.LLM_PROVIDER;
	const raw =
		explicit === "anthropic"
			? createAnthropicProvider()
			: explicit === "openai"
				? createOpenAiProvider()
				: explicit === "google"
					? createGoogleProvider()
					: config.ANTHROPIC_API_KEY
						? createAnthropicProvider()
						: config.OPENAI_API_KEY
							? createOpenAiProvider()
							: config.GOOGLE_API_KEY
								? createGoogleProvider()
								: null;
	if (!raw) {
		throw new Error("No LLM provider configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY.");
	}
	return {
		name: raw.name,
		model: raw.model,
		complete: (req) => llmSemaphore.run(() => callWithRetry(raw, req)),
	};
}

/** True when at least one LLM provider key is set. Used by the
 * same-product matcher to decide whether to short-circuit. */
export function isAnyLlmConfigured(): boolean {
	return Boolean(config.ANTHROPIC_API_KEY || config.OPENAI_API_KEY || config.GOOGLE_API_KEY);
}
