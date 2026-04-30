/**
 * Concurrency probe for the configured LLM provider. Sweeps N from 1
 * upward, fires N parallel `complete()` calls per round, reports
 * latency distribution + error rate. Used to set `LLM_MAX_CONCURRENT`
 * to a safe ceiling for the active provider tier.
 *
 * Bypasses both wrappers (semaphore, retry) so we measure the RAW
 * provider response — that's what the cap is meant to bound.
 *
 * Run: cd packages/api && node --env-file=.env --import tsx scripts/llm-concurrency-probe.ts
 */

import { config } from "../src/config.js";
import { createAnthropicProvider } from "../src/services/match/llm/anthropic.js";
import { createGoogleProvider } from "../src/services/match/llm/google.js";
import type { LlmProvider, LlmRequest } from "../src/services/match/llm/index.js";
import { createOpenAiProvider } from "../src/services/match/llm/openai.js";

const SWEEP = [1, 2, 4, 8, 12, 16, 24, 32];
const ROUNDS_PER_N = 2;
const PROMPT: LlmRequest = {
	system: "Return a 1-word answer only.",
	user: [{ type: "text", text: "What's the capital of France?" }],
	maxTokens: 16,
};

function pickRawProvider(): LlmProvider {
	const explicit = config.LLM_PROVIDER;
	if (explicit === "anthropic") return createAnthropicProvider();
	if (explicit === "openai") return createOpenAiProvider();
	if (explicit === "google") return createGoogleProvider();
	if (config.ANTHROPIC_API_KEY) return createAnthropicProvider();
	if (config.OPENAI_API_KEY) return createOpenAiProvider();
	if (config.GOOGLE_API_KEY) return createGoogleProvider();
	throw new Error("no provider configured");
}

interface Sample {
	durationMs: number;
	ok: boolean;
	errorName?: string;
	errorStatus?: number;
}

function pct(arr: number[], p: number): number {
	if (arr.length === 0) return 0;
	const sorted = [...arr].sort((a, b) => a - b);
	const idx = Math.floor((sorted.length - 1) * p);
	return sorted[idx] ?? 0;
}

function fmtErr(err: unknown): { name: string; status?: number } {
	if (typeof err !== "object" || err === null) return { name: String(err) };
	const e = err as { name?: unknown; status?: unknown; statusCode?: unknown; message?: unknown };
	const status =
		typeof e.status === "number" ? e.status : typeof e.statusCode === "number" ? e.statusCode : undefined;
	const name = typeof e.name === "string" && e.name !== "Error" ? e.name : (e.message as string | undefined) ?? "Error";
	return { name: String(name).slice(0, 60), status };
}

async function fireOnce(provider: LlmProvider): Promise<Sample> {
	const start = performance.now();
	try {
		await provider.complete(PROMPT);
		return { durationMs: performance.now() - start, ok: true };
	} catch (err) {
		const f = fmtErr(err);
		if (process.env.PROBE_DEBUG) console.error("[probe:err]", err);
		return { durationMs: performance.now() - start, ok: false, errorName: f.name, errorStatus: f.status };
	}
}

async function runRound(provider: LlmProvider, n: number): Promise<Sample[]> {
	const tasks = Array.from({ length: n }, () => fireOnce(provider));
	return Promise.all(tasks);
}

async function main(): Promise<void> {
	const provider = pickRawProvider();
	console.log(`[probe] provider=${provider.name} model=${provider.model}`);
	// Warmup — first call has cold-DNS / SDK-init cost that is not part
	// of the concurrency answer we're trying to measure.
	console.log("[probe] warmup…");
	await fireOnce(provider).catch(() => undefined);
	console.log("");
	console.log("  N  | round | ok / total |  p50  |  p95  | maxLat | errors");
	console.log("-----+-------+------------+-------+-------+--------+--------------------");
	for (const n of SWEEP) {
		for (let r = 0; r < ROUNDS_PER_N; r++) {
			const samples = await runRound(provider, n);
			const oks = samples.filter((s) => s.ok);
			const errs = samples.filter((s) => !s.ok);
			const lat = oks.map((s) => s.durationMs);
			const errMsg = errs.length
				? Object.entries(
						errs.reduce<Record<string, number>>((acc, s) => {
							const k = `${s.errorStatus ?? "-"}:${s.errorName ?? "?"}`;
							acc[k] = (acc[k] ?? 0) + 1;
							return acc;
						}, {}),
					)
						.map(([k, c]) => `${k} ×${c}`)
						.join(", ")
				: "";
			const maxLat = samples.length ? Math.max(...samples.map((s) => s.durationMs)) : 0;
			console.log(
				` ${String(n).padStart(2)}  |  ${r + 1}/${ROUNDS_PER_N}  |  ${String(oks.length).padStart(2)}  /  ${String(samples.length).padStart(2)}   | ${String(Math.round(pct(lat, 0.5))).padStart(5)} | ${String(Math.round(pct(lat, 0.95))).padStart(5)} | ${String(Math.round(maxLat)).padStart(6)} | ${errMsg}`,
			);
			// breathe between rounds so a token-bucket window can refill
			await new Promise((res) => setTimeout(res, 1500));
		}
	}
}

main().catch((err) => {
	console.error("[probe] fatal:", err);
	process.exit(1);
});
