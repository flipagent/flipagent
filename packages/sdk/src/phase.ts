/**
 * Single source of truth for the human-readable label that describes
 * which pipeline phase an in-flight evaluate run is in. Every UI
 * surface — playground inline notice, embed iframe eyebrow, extension
 * chip step text — calls this so the copy reads identical across the
 * product. Add or rephrase here, all surfaces pick it up.
 *
 * Pure: takes a (possibly empty) `Partial<EvaluatePartial>`, returns
 * a string. Order of checks matters — most-advanced state wins so the
 * label always reflects the latest pipeline phase, not whichever
 * field was hydrated first.
 */

import type { EvaluatePartial } from "@flipagent/types";

/**
 * Render the phase label for an evaluate run. `pending=false` short-
 * circuits to the completed label so callers don't have to special-case
 * terminal states themselves.
 */
export function describeEvaluatePhase(partial: Partial<EvaluatePartial> | undefined, pending: boolean): string {
	if (!pending) return "Evaluation";
	if (!partial || !partial.anchor) return "Looking up listing…";

	// Evaluation field set ⇒ scoring step has resolved; we're past the
	// final digest and just doing the per-user math.
	if (partial.evaluation) return "Crunching the numbers…";

	// Filter is the longest opaque step. When live progress lands it
	// supersedes every other label so users see the LLM phase moving.
	if (partial.filterProgress) {
		const { processed, total } = partial.filterProgress;
		if (total > 0 && processed >= total) return "Wrapping up…";
		return `Verifying matches · ${processed}/${total}`;
	}

	// `preliminary === false` lands once the post-filter `digest` event
	// arrives — the matched pools are confirmed but evaluation hasn't
	// scored yet.
	if (partial.preliminary === false) return "Crunching the numbers…";
	if (partial.preliminary === true) return "Verifying same-product matches…";

	// Pre-preliminary phase: we have one or both raw pools but no digest yet.
	const haveSold = (partial.soldPool?.length ?? 0) > 0;
	const haveActive = (partial.activePool?.length ?? 0) > 0;
	if (haveSold && haveActive) return "Verifying same-product matches…";
	if (haveSold) return "Pulling active competition…";
	if (haveActive) return "Pulling recent sales…";

	return "Searching the market…";
}
