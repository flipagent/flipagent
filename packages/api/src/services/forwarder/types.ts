/**
 * Public types for US-domestic forwarder fee estimation. All monetary fields
 * are cents-denominated integers (matches the `services/quant` convention).
 * Weight in grams. Length in centimeters. ISO 3166-2 US state codes
 * (2 letters, no `US-` prefix).
 */

/** Carrier service tier offered by a forwarder. Drives rate-table lookup. */
export type CarrierService = "usps_priority" | "usps_ground_advantage" | "ups_ground" | "fedex_home";

/**
 * USPS-style zone band, condensed. Mapped from origin → destination state.
 * Real USPS uses 1–9 from the origin ZIP3, but for arbitrage planning the
 * coarse `local / west / central / east / offshore` bucketing is plenty.
 */
export type ZoneBand = "local" | "west" | "central" | "east" | "offshore";

export interface ForwarderInputs {
	/** Total package weight (after consolidation), grams. */
	weightG: number;
	/** Optional bounding-box dims for dim-weight billing, cm. */
	dimsCm?: { l: number; w: number; h: number };
	/** Destination US state code, e.g. `"NY"`, `"TX"`, `"HI"`. */
	destState: string;
	/** Number of inbound items being consolidated. Default 1. */
	itemCount?: number;
	/** Carrier choice. Each provider supports a subset; resolver clamps to default. */
	service?: CarrierService;
}

export interface ForwarderShippingRate {
	/** Min weight (grams), inclusive. */
	minWeightG: number;
	/** Max weight (grams), exclusive. */
	maxWeightG: number;
	/** Cost in cents to ship a package whose weight falls in [min, max). */
	costCents: number;
}

export interface ForwarderProvider {
	id: string;
	name: string;
	/** State the warehouse sits in. Drives origin-state → zone-band mapping. */
	originState: string;
	/** Per-package handling fee in cents (receive + photo + basic repack). */
	handlingCents: number;
	/** Fee per consolidated item beyond the first. */
	perExtraItemCents: number;
	/** Flat consolidation fee on top of handling, when ≥2 items. */
	consolidationCents: number;
	/** Dim-weight divisor (cm³ per kg). Carrier convention (5000 for DHL/FedEx-style, 6000 for some). */
	dimDivisor: number;
	/** Default service tier when caller omits `service`. */
	defaultService: CarrierService;
	/** Shipping rate tables, keyed by `${service}:${zoneBand}`. */
	rateTables: Record<string, ForwarderShippingRate[]>;
	/** Free-form notes shown in quote output. */
	notes: string[];
}

export interface ForwarderQuote {
	providerId: string;
	service: CarrierService;
	zoneBand: ZoneBand;
	chargeableWeightG: number;
	handlingCents: number;
	shippingCents: number;
	/** handlingCents + shippingCents. */
	totalCents: number;
	/** Plain-English breakdown lines. */
	breakdown: string[];
	/** Rough delivery window in business days, [min, max]. */
	etaDays: [number, number];
	/** Caveats — dim-weight billed, fallback table, etc. */
	caveats: string[];
}
