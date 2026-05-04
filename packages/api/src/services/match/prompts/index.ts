/**
 * Category-aware prompt resolution. Maps the candidate's eBay
 * `categoryIdPath` to the right verifier prompt — base alone for unknown
 * categories, base + category overlay for the families we've explicitly
 * tuned.
 *
 * To add a new category:
 *   1. Write a new file in `overlays/<slug>.ts` exporting one
 *      `<NAME>_VERIFY_OVERLAY` string with the category-specific rules.
 *   2. Add one entry to REGISTRY below pointing at the eBay leaf
 *      categoryId.
 *   3. (Optional) ship a labeled dataset under that categoryId so the
 *      regression suite measures it.
 *
 * No edit to base.ts required. No edit to matcher.ts required.
 *
 * eBay category IDs are stable identifiers eBay almost never renumbers,
 * so the registry is a long-lived mapping. The categoryIdPath check
 * accepts ANY id in the path — so a sub-category that doesn't have its
 * own overlay falls back to the nearest ancestor that does, and
 * ultimately to the base prompt.
 */

import { SYSTEM_TRIAGE, SYSTEM_VERIFY_BASE } from "./base.js";
import { ATHLETIC_SHOES_VERIFY_OVERLAY } from "./overlays/athletic-shoes.js";
import { CCG_CARDS_VERIFY_OVERLAY } from "./overlays/ccg-cards.js";
import { CONSOLES_VERIFY_OVERLAY } from "./overlays/consoles.js";
import { SMARTPHONES_VERIFY_OVERLAY } from "./overlays/smartphones.js";
import { WRISTWATCHES_VERIFY_OVERLAY } from "./overlays/wristwatches.js";

export { SYSTEM_TRIAGE, SYSTEM_VERIFY_BASE };

interface OverlayEntry {
	/** eBay leaf categoryIds covered by this overlay. */
	categoryIds: readonly string[];
	/** Human-readable name (used for logging / debug). */
	name: string;
	/** The category-specific text appended to the base prompt. */
	overlay: string;
}

const REGISTRY: readonly OverlayEntry[] = [
	{ categoryIds: ["9355"], name: "smartphones", overlay: SMARTPHONES_VERIFY_OVERLAY },
	{ categoryIds: ["31387"], name: "wristwatches", overlay: WRISTWATCHES_VERIFY_OVERLAY },
	{ categoryIds: ["15709"], name: "athletic-shoes", overlay: ATHLETIC_SHOES_VERIFY_OVERLAY },
	{ categoryIds: ["183454"], name: "ccg-cards", overlay: CCG_CARDS_VERIFY_OVERLAY },
	{ categoryIds: ["139973"], name: "consoles", overlay: CONSOLES_VERIFY_OVERLAY },
];

/**
 * Resolve the verifier prompt for a candidate item. Returns base alone
 * when no overlay matches (unknown category); base + overlay when one
 * does.
 *
 * `categoryIdPath` is the pipe-joined hierarchy ItemDetail emits —
 * e.g. "293|15032|9355" for an iPhone (Electronics > Cell Phones &
 * Accessories > Cell Phones & Smartphones). We check membership of any
 * id in the path against the registry, so sub-categories inherit their
 * ancestor's overlay automatically.
 */
export function pickVerifyPrompt(categoryIdPath?: string | null): string {
	if (!categoryIdPath) return SYSTEM_VERIFY_BASE;
	const ids = new Set(categoryIdPath.split("|").filter(Boolean));
	for (const entry of REGISTRY) {
		if (entry.categoryIds.some((id) => ids.has(id))) {
			return `${SYSTEM_VERIFY_BASE}\n\n${entry.overlay}`;
		}
	}
	return SYSTEM_VERIFY_BASE;
}

/**
 * Diagnostic: returns the overlay name (or null) that would be applied
 * for a given path. Used by `traceLog` so we can see in logs which
 * overlay fired per evaluate call.
 */
export function pickVerifyOverlayName(categoryIdPath?: string | null): string | null {
	if (!categoryIdPath) return null;
	const ids = new Set(categoryIdPath.split("|").filter(Boolean));
	for (const entry of REGISTRY) {
		if (entry.categoryIds.some((id) => ids.has(id))) return entry.name;
	}
	return null;
}
