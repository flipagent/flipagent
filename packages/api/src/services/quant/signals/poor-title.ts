import type { Listing, Signal } from "../types.js";

/**
 * Heuristic for under-discovered listings. Titles that are all-caps,
 * very short, or full of stop characters tend to rank poorly in
 * marketplace search — they sit at the bottom of the price distribution
 * because few buyers ever see them.
 */
export function poorTitle(listing: Listing): Signal | null {
	const title = listing.title.trim();
	const words = title.split(/\s+/).filter((w) => w.length > 0);
	const allCaps = /^[A-Z\s\d!?.]+$/.test(title) && title.length >= 12;
	const tooShort = words.length < 5;
	const reasons: string[] = [];
	if (allCaps) reasons.push("ALL CAPS");
	if (tooShort) reasons.push(`only ${words.length} word${words.length === 1 ? "" : "s"}`);
	if (reasons.length === 0) return null;
	return {
		kind: "poor_title",
		strength: reasons.length === 2 ? 0.8 : 0.5,
		reason: `title looks low-effort: ${reasons.join(", ")}`,
	};
}
