/**
 * Three-bucket classifier over a pool of `ItemSummary`. Returns each
 * comp annotated with a 0–1 score and a `match` / `borderline` /
 * `reject` bucket so the caller (or its host LLM) can:
 *
 *   - feed `match` directly into `/v1/research/thesis` + `/v1/evaluate`,
 *   - inspect each `borderline` (fetch detail, compare aspects + image)
 *     and decide whether to keep it,
 *   - drop `reject` entirely.
 *
 * Today's signal is title token overlap (IDF-weighted) plus condition
 * equality. Aspect / image comparison is intentionally not run server-
 * side — that's the host LLM's vision call when it inspects borderlines.
 * Adding more deterministic signals is fine; running an LLM here is
 * not.
 */

import type { MatchBucket, MatchedItem, MatchOptions, MatchResponse } from "@flipagent/types";
import type { ItemSummary } from "@flipagent/types/ebay";
import { buildIdf, idfWeightedOverlap, tokenize } from "./score.js";

const DEFAULTS = {
	matchThreshold: 0.7,
	borderlineThreshold: 0.4,
	conditionPenalty: 0.5,
};

export function matchPool(
	candidate: ItemSummary,
	pool: ReadonlyArray<ItemSummary>,
	options: MatchOptions = {},
): MatchResponse {
	const matchThreshold = options.matchThreshold ?? DEFAULTS.matchThreshold;
	const borderlineThreshold = options.borderlineThreshold ?? DEFAULTS.borderlineThreshold;
	const conditionPenalty = options.conditionPenalty ?? DEFAULTS.conditionPenalty;

	const titles = [candidate.title, ...pool.map((p) => p.title)];
	const idf = buildIdf(titles);
	const candidateTokens = new Set(tokenize(candidate.title));

	const match: MatchedItem[] = [];
	const borderline: MatchedItem[] = [];
	const reject: MatchedItem[] = [];

	for (const comp of pool) {
		const compTokens = new Set(tokenize(comp.title));
		const titleOverlap = idfWeightedOverlap(candidateTokens, compTokens, idf);
		const reasons: string[] = [`title overlap ${(titleOverlap * 100).toFixed(0)}%`];

		let score = titleOverlap;
		// Condition equality: only meaningful when both sides know their
		// condition. If either is missing, skip the multiplier (we don't
		// want to punish unknown).
		if (candidate.conditionId && comp.conditionId) {
			if (candidate.conditionId === comp.conditionId) {
				reasons.push("condition match");
			} else {
				score *= conditionPenalty;
				reasons.push(
					`condition mismatch (${candidate.condition ?? candidate.conditionId} vs ${comp.condition ?? comp.conditionId})`,
				);
			}
		}

		const bucket: MatchBucket =
			score >= matchThreshold ? "match" : score >= borderlineThreshold ? "borderline" : "reject";

		const labeled: MatchedItem = {
			item: comp,
			score: Number(score.toFixed(4)),
			bucket,
			reason: reasons.join("; "),
		};
		if (bucket === "match") match.push(labeled);
		else if (bucket === "borderline") borderline.push(labeled);
		else reject.push(labeled);
	}

	const sortByScore = (a: MatchedItem, b: MatchedItem) => b.score - a.score;
	match.sort(sortByScore);
	borderline.sort(sortByScore);
	reject.sort(sortByScore);

	return {
		match,
		borderline,
		reject,
		totals: { match: match.length, borderline: borderline.length, reject: reject.length },
	};
}
