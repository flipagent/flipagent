/**
 * Planet Express — California-based US package forwarder (Torrance, CA).
 *
 * Domestic-only rate tables below approximate USPS Priority Mail and UPS
 * Ground out of Planet Express's CA warehouse, binned by weight tier and
 * coarse zone band (local / west / central / east / offshore). Cents-
 * denominated. Numbers are 2026-Q1 ballparks rounded to whole dollars; not
 * live quotes. Update via PR when their public calculator changes or when
 * USPS retail tariffs shift.
 *
 * Source of truth: https://planetexpress.com/calculator
 */

import type { ForwarderProvider, ForwarderShippingRate } from "../types.js";

function tier(rows: Array<[number, number, number]>): ForwarderShippingRate[] {
	return rows.map(([minWeightG, maxWeightG, costCents]) => ({ minWeightG, maxWeightG, costCents }));
}

// USPS Priority Mail, origin CA → ZoneBand. Costs in cents.
const PRIORITY_LOCAL = tier([
	[0, 454, 980],
	[454, 907, 1080],
	[907, 1814, 1240],
	[1814, 4536, 1480],
	[4536, 9072, 2050],
	[9072, 22680, 4200],
]);

const PRIORITY_WEST = tier([
	[0, 454, 1090],
	[454, 907, 1320],
	[907, 1814, 1640],
	[1814, 4536, 2150],
	[4536, 9072, 3500],
	[9072, 22680, 7800],
]);

const PRIORITY_CENTRAL = tier([
	[0, 454, 1180],
	[454, 907, 1480],
	[907, 1814, 1980],
	[1814, 4536, 2900],
	[4536, 9072, 4900],
	[9072, 22680, 11000],
]);

const PRIORITY_EAST = tier([
	[0, 454, 1280],
	[454, 907, 1700],
	[907, 1814, 2400],
	[1814, 4536, 3700],
	[4536, 9072, 6500],
	[9072, 22680, 14500],
]);

const PRIORITY_OFFSHORE = tier([
	[0, 454, 1480],
	[454, 907, 2150],
	[907, 1814, 3400],
	[1814, 4536, 5600],
	[4536, 9072, 9800],
	[9072, 22680, 22000],
]);

// UPS Ground, origin CA → ZoneBand. Cheaper than Priority for heavier boxes,
// pricier for very small ones.
const UPS_LOCAL = tier([
	[0, 907, 1090],
	[907, 2268, 1240],
	[2268, 4536, 1450],
	[4536, 9072, 1850],
	[9072, 22680, 2850],
]);

const UPS_WEST = tier([
	[0, 907, 1290],
	[907, 2268, 1580],
	[2268, 4536, 1980],
	[4536, 9072, 2700],
	[9072, 22680, 4400],
]);

const UPS_CENTRAL = tier([
	[0, 907, 1490],
	[907, 2268, 1980],
	[2268, 4536, 2700],
	[4536, 9072, 3850],
	[9072, 22680, 7200],
]);

const UPS_EAST = tier([
	[0, 907, 1690],
	[907, 2268, 2350],
	[2268, 4536, 3300],
	[4536, 9072, 5100],
	[9072, 22680, 9800],
]);

// UPS Ground typically does not serve AK/HI; we mark offshore as a flag and
// rely on USPS for those. The wildcard table makes the resolver succeed.
const UPS_OFFSHORE = tier([
	[0, 907, 9999],
	[907, 22680, 99999],
]);

export const planetExpress: ForwarderProvider = {
	id: "planet-express",
	name: "Planet Express",
	originState: "CA",
	// $5 receive-and-process per package on basic plan.
	handlingCents: 500,
	perExtraItemCents: 50,
	consolidationCents: 0,
	dimDivisor: 5000,
	defaultService: "usps_priority",
	rateTables: {
		"usps_priority:local": PRIORITY_LOCAL,
		"usps_priority:west": PRIORITY_WEST,
		"usps_priority:central": PRIORITY_CENTRAL,
		"usps_priority:east": PRIORITY_EAST,
		"usps_priority:offshore": PRIORITY_OFFSHORE,
		"ups_ground:local": UPS_LOCAL,
		"ups_ground:west": UPS_WEST,
		"ups_ground:central": UPS_CENTRAL,
		"ups_ground:east": UPS_EAST,
		"ups_ground:offshore": UPS_OFFSHORE,
	},
	notes: [
		"30 days free storage; $0.50/day after",
		"Free repack on request",
		"Photos free; itemized photos $2 each",
		"UPS Ground does not serve AK/HI — fall back to USPS Priority",
	],
};
