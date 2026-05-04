/**
 * eBay condition pre-filter for evaluate's sold-comparable pool.
 *
 * eBay prices listings very differently per condition — and within
 * coarse "tiers" too (Brand New $1100 vs Open Box $700 for an iPhone).
 * For evaluate's price comparison to be reliable, the pool must contain
 * ONLY items at the same exact condition as the seed.
 *
 * Earlier this file bundled Brand New + New (Other) + Open Box as a
 * single "new" tier — fine for low-value categories (watches: 5-10%
 * spread) but disastrous for high-value electronics (30-50% spread).
 * Strict per-conditionId filtering is the safer default.
 *
 * The two "new" sub-conditions that genuinely DO price together are
 * Brand-New (1000) and "New with defects" (1750) — both factory-fresh,
 * sealed (defects = packaging blemish), so include 1750 with 1000.
 *
 * Refurbished sub-conditions (2000-2040) all share roughly the same
 * resale price, so still grouped. Same for the used "grades"
 * (3000=Pre-Owned, 4000=Very Good, 5000=Good, 6000=Acceptable) which
 * eBay treats as resale-equivalent though slight grade differences.
 */

const SINGLETON_GROUPS: Record<string, string[]> = {
	"1000": ["1000", "1750"], // Brand New + New with defects (factory sealed)
	"1500": ["1500"], // New (Other) / Open box — separate price tier
	"1750": ["1000", "1750"],
};

const REFURB_IDS = ["2000", "2010", "2020", "2030", "2040", "2500"];
const USED_IDS = ["3000", "4000", "5000", "6000"];

const GROUP_FOR_ID: Record<string, string[]> = {
	"1000": SINGLETON_GROUPS["1000"]!,
	"1500": SINGLETON_GROUPS["1500"]!,
	"1750": SINGLETON_GROUPS["1750"]!,
	"2000": REFURB_IDS,
	"2010": REFURB_IDS,
	"2020": REFURB_IDS,
	"2030": REFURB_IDS,
	"2040": REFURB_IDS,
	"2500": REFURB_IDS,
	"2750": ["2750"], // Like New — its own tier (sneakers/clothes deadstock-ish)
	"3000": USED_IDS,
	"4000": USED_IDS,
	"5000": USED_IDS,
	"6000": USED_IDS,
	"7000": ["7000"], // For parts
};

/**
 * Build the array of conditionIds the seed should be searched against,
 * given its `conditionId`. Returns `undefined` when the seed has no
 * resolvable condition (no filter applied — fall back to full pool).
 */
export function tierConditionIdsFor(seedConditionId: string | null | undefined): string[] | undefined {
	if (!seedConditionId) return undefined;
	return GROUP_FOR_ID[seedConditionId];
}
