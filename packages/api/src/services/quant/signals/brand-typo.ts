/**
 * Generate plausible misspellings of a brand name. Misspelled listings
 * surface fewer searchers and therefore tend to clear at the bottom of the
 * price distribution. Iterating these variants through a search call is
 * the actual signal — this module just produces the string set.
 */

import type { Listing, Signal } from "../types.js";

/**
 * Generate edit-distance-1 variants likely to be real-world typos:
 *   - drop one letter
 *   - double one consonant
 *   - swap adjacent letters
 *   - common substitutions: ck↔k, ph↔f, ie↔ei
 * Filters trivial cases (single-char results, exact match to original).
 *
 * Examples for known luxury brands:
 *   "Louis Vuitton" → ["loui vuitton", "louis vutton", "louis vitton", ...]
 *   "Canon"         → ["canon", "cannon", "cnon", "caon", ...]
 *   "Rolex"         → ["roex", "rollex", "rolxe", ...]
 */
export function generateBrandTypos(brand: string, max = 12): string[] {
	const lower = brand.toLowerCase();
	const variants = new Set<string>();
	const chars = [...lower];

	for (let i = 0; i < chars.length; i++) {
		const dropped = chars.filter((_, j) => j !== i).join("");
		if (dropped.length >= 3) variants.add(dropped);
	}

	const consonants = /[bcdfghjklmnpqrstvwxz]/i;
	for (let i = 0; i < chars.length; i++) {
		const c = chars[i];
		if (c && consonants.test(c)) {
			const doubled = chars
				.slice(0, i + 1)
				.concat([c])
				.concat(chars.slice(i + 1))
				.join("");
			variants.add(doubled);
		}
	}

	for (let i = 0; i < chars.length - 1; i++) {
		const swapped = [...chars];
		[swapped[i], swapped[i + 1]] = [swapped[i + 1] ?? "", swapped[i] ?? ""];
		variants.add(swapped.join(""));
	}

	const subs: [RegExp, string][] = [
		[/ck/g, "k"],
		[/k/g, "ck"],
		[/ph/g, "f"],
		[/f/g, "ph"],
		[/ie/g, "ei"],
		[/ei/g, "ie"],
	];
	for (const [pat, repl] of subs) {
		const subbed = lower.replace(pat, repl);
		if (subbed !== lower) variants.add(subbed);
	}

	variants.delete(lower);
	return [...variants].slice(0, max);
}

/**
 * Detector for the case where a fetched listing's title contains a
 * known typo of the brand. Used after iterating typo variants through search.
 */
export function brandTypo(listing: Listing, brand: string): Signal | null {
	const typos = generateBrandTypos(brand);
	const titleLower = listing.title.toLowerCase();
	const matched = typos.find((t) => titleLower.includes(t));
	if (!matched) return null;
	return {
		kind: "brand_typo",
		strength: 0.7,
		reason: `title contains misspelling "${matched}" of brand "${brand}"`,
	};
}
