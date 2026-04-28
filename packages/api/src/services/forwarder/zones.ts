/**
 * Coarse origin-state → destination-state → ZoneBand mapping. Real USPS zone
 * computation needs the 3-digit origin and destination ZIPs; for arbitrage
 * planning we approximate with a 5-band split. Update when shipping out of a
 * different warehouse.
 */

import type { ZoneBand } from "./types.js";

const OFFSHORE = new Set(["AK", "HI", "PR", "VI", "GU", "AS", "MP"]);

/**
 * Source: rough USPS Priority Mail zones with origin = California (905xx).
 * Adjacent zones collapse to one band. Tweak to taste.
 */
const FROM_CA: Record<ZoneBand, string[]> = {
	local: ["CA"],
	// USPS zones 4–5 from CA: neighboring west.
	west: ["AZ", "NV", "OR", "WA", "ID", "UT"],
	// USPS zones 6–7 from CA: mountain + central.
	central: ["NM", "CO", "WY", "MT", "ND", "SD", "NE", "KS", "TX", "OK", "AR", "LA", "MN", "IA", "MO"],
	// USPS zone 8 from CA: everything else CONUS.
	east: [
		"WI",
		"IL",
		"IN",
		"MI",
		"OH",
		"KY",
		"TN",
		"MS",
		"AL",
		"GA",
		"FL",
		"SC",
		"NC",
		"VA",
		"WV",
		"PA",
		"NY",
		"NJ",
		"CT",
		"RI",
		"MA",
		"VT",
		"NH",
		"ME",
		"MD",
		"DE",
		"DC",
	],
	// AK / HI / territories.
	offshore: ["AK", "HI", "PR", "VI", "GU", "AS", "MP"],
};

const ZONE_LOOKUPS: Record<string, Record<string, ZoneBand>> = {
	CA: invert(FROM_CA),
};

function invert(bands: Record<ZoneBand, string[]>): Record<string, ZoneBand> {
	const out: Record<string, ZoneBand> = {};
	for (const band of Object.keys(bands) as ZoneBand[]) {
		for (const state of bands[band]) out[state] = band;
	}
	return out;
}

/**
 * Resolve the zone band for a shipment from `originState` to `destState`.
 * Falls back to `east` for unknown CONUS pairs and `offshore` for known
 * non-CONUS destinations.
 */
export function zoneBandFor(originState: string, destState: string): ZoneBand {
	if (OFFSHORE.has(destState)) return "offshore";
	const table = ZONE_LOOKUPS[originState];
	if (!table) return "east";
	return table[destState] ?? "east";
}
