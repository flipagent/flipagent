/**
 * Public types shared across all quant modules. The `QuantListing` shape
 * matches the field set common to modern resale-marketplace listing
 * APIs — eBay's Browse `ItemSummary`, Mercari's listing JSON, Etsy's
 * Listing v3, etc. — so an adapter for any of these fits in a few
 * lines. Auction-specific fields (bidCount/endTime/buyingFormat) are
 * optional and ignored on fixed-price marketplaces.
 */

export interface QuantListing {
	/** Stable per-marketplace identifier. */
	itemId: string;
	title: string;
	url: string;
	priceCents: number;
	/**
	 * Informational pass-through (e.g. "USD"). Quant does not consume
	 * this — all internal math is single-currency at the cents level.
	 * Callers may use it to render or to refuse cross-currency comparables.
	 */
	currency: string;
	shippingCents?: number;
	condition?: string;
	/** "AUCTION" | "FIXED_PRICE" — affects which signals apply. */
	buyingFormat?: "AUCTION" | "FIXED_PRICE";
	bidCount?: number;
	watchCount?: number;
	/** ISO 8601 string, only meaningful for AUCTION. */
	endTime?: string;
}

/**
 * One sold sample — input to the median + summarizeSold pipeline.
 */
export interface PriceObservation {
	priceCents: number;
	soldAt?: string | Date | null;
	/**
	 * Days the listing was alive before it sold (i.e. soldAt − listedAt).
	 * Optional — populated when caller has list→sold duration data
	 * (Browse API `itemCreationDate` + `itemEndDate`, or SPRD's own
	 * record_listing/record_transaction tables). When present on enough
	 * obs, `summarizeSold` aggregates them into `meanDaysToSell` for
	 * downstream time-to-sell + capital-efficiency math.
	 */
	durationDays?: number;
	/**
	 * Free-form condition tag (e.g. "used", "new", "for parts"). Carried
	 * through so callers can pre-filter comparables by condition before
	 * summarizing. Quant itself does not stratify — pass already-filtered
	 * cohorts in for cleaner stats.
	 */
	condition?: string;
}

/** One active listing's ask price — input to `summarizeAsks`. */
export interface ActiveAsk {
	priceCents: number;
}

/**
 * Active-side summary — distribution of current listing prices for the
 * same keyword/marketplace as the sold-side `MarketStats`. Optional on
 * MarketStats; provide via `summarizeAsks` or the `summarizeMarket`
 * composer.
 */
export interface AskStats {
	meanCents: number;
	stdDevCents: number;
	medianCents: number;
	p25Cents: number;
	p75Cents: number;
	/** Number of active listings observed (after IQR cleaning). */
	nActive: number;
}

/**
 * Aggregated sold-price stats for a keyword + marketplace + window.
 * Output shape of `summarizeSold` and `summarizeMarket`. Pure data —
 * quant has no runtime dependency on any data plane.
 *
 * `asks?` is populated when caller supplied active-listing data via
 * `summarizeMarket` / `summarizeAsks`. `meanDaysToSell?` and friends
 * are populated when at least one comparable carried `durationDays`.
 */
export interface MarketStats {
	keyword: string;
	marketplace: string;
	windowDays: number;
	/**
	 * Arithmetic mean of cleaned sold prices. This is the probability-
	 * weighted expectation of sale price under the empirical distribution
	 * — what you'd expect to receive if listed and sold. The single
	 * "what's it worth" anchor; downstream margin math is mean-based.
	 */
	meanCents: number;
	/** Population std-dev of cleaned sold prices. Uncertainty around `meanCents`. */
	stdDevCents: number;
	/** Robust quantiles (kept for display + descriptive stats). */
	medianCents: number;
	/** Bootstrap 90% CI on the median (n ≥ 5). Undefined for tiny samples. */
	medianCiLowCents?: number;
	medianCiHighCents?: number;
	p25Cents: number;
	p75Cents: number;
	nObservations: number;
	/**
	 * Effective sales per day fed into the Erlang queue model in
	 * `recommendListPrice` (time = (queueAhead + 1) / λ). Two contributors:
	 *
	 *   1. Comp-pool rate — exponentially recency-weighted (half-life
	 *      `windowDays/3`). Collapses to `n / windowDays` when sales are
	 *      uniformly distributed in the window or when most observations
	 *      lack `soldAt` timestamps. Stored separately as
	 *      `salesPerDayBaseline` when the seed-listing blend kicks in.
	 *   2. Seed listing per-listing rate — `soldQuantity / days_active`,
	 *      stored as `salesPerDaySeed`. Surfaces multi-quantity listings
	 *      whose sell-through is faster than the comp average (e.g. a
	 *      seller has shipped 10 from THIS listing in 30d while the comp
	 *      pool reads 0.2/day). Blend uses geometric-mean dampening so a
	 *      single hot seed doesn't catapult the forecast.
	 *
	 * The blend is asymmetric — the seed signal can RAISE the rate but
	 * never lower it (we'll relist under our own listing, so a slow seed
	 * doesn't constrain our forecast). When the seed has no usable data
	 * the blend is a no-op and `salesPerDay === salesPerDayBaseline`.
	 */
	salesPerDay: number;
	/**
	 * Pre-blend comp-pool rate. Set when seed-listing blending was
	 * applied (i.e., `salesPerDaySeed` is also set). Absent when no
	 * blending happened — `salesPerDay` is the baseline in that case.
	 */
	salesPerDayBaseline?: number;
	/**
	 * Seed listing's own per-listing rate
	 * (`soldQuantity / clamp(days_since_creation, 1..60)`). The window
	 * is capped at 60 days to avoid GTC stale-chain distortion — beyond
	 * that the average rate underestimates the listing's current pace
	 * since eBay's "X sold" badge tracks recent cycles, not original
	 * creation. Absent when the seed lacked `estimatedSoldQuantity` or
	 * `itemCreationDate`, or when the listing is too fresh (<1d).
	 */
	salesPerDaySeed?: number;
	/**
	 * Time-to-sell statistics — populated when at least one PriceObservation
	 * carried `durationDays`. Undefined when no comparable had duration data.
	 */
	meanDaysToSell?: number;
	daysStdDev?: number;
	/** Time-to-sell percentiles (n ≥ 5). Together with mean/std they describe spread. */
	daysP50?: number;
	daysP70?: number;
	daysP90?: number;
	/** How many comparables contributed to meanDaysToSell (≤ nObservations). */
	nDurations?: number;
	/** Active-side stats (current asks). Populated when caller passed asks. */
	asks?: AskStats;
	asOf: string;
}

export interface FeeModel {
	/**
	 * Variable sale-fee rate, e.g. 0.1325 (13.25%). On most resale
	 * marketplaces this is the "final value" / "transaction" / "selling"
	 * fee. eBay calls it FVF, Etsy "transaction fee", Mercari "selling
	 * fee". The rate is applied to the gross sale price.
	 */
	feeRate: number;
	/** Fixed per-order fee in cents, e.g. 30 for $0.30. */
	fixedCents: number;
	/**
	 * Optional ad-surcharge rate on top of the base fee — eBay's Promoted
	 * Listings, Etsy's Offsite Ads, etc. Range 0..~0.15. Charged on the
	 * same gross sale price as `feeRate`.
	 */
	promotionRate?: number;
}

/**
 * Default fee schedule — eBay US Most-Categories final-value fee
 * (13.25% + $0.30) as of late 2025. Override per-marketplace (Mercari
 * 10%, Etsy 6.5% + $0.20, etc.) by passing your own `FeeModel`.
 */
export const DEFAULT_FEES: FeeModel = {
	feeRate: 0.1325,
	fixedCents: 30,
};

/** Inputs to net-margin math. All fields cents-denominated. */
export interface MarginInputs {
	/** Estimated re-list price (target) in cents. Usually market median × 0.95. */
	estimatedSaleCents: number;
	/** Cost to acquire (the listing's BIN or our offer) in cents. */
	buyPriceCents: number;
	/** Inbound shipping to forwarder / buyer in cents. */
	inboundShippingCents?: number;
	/** Outbound shipping when re-listing in cents. */
	outboundShippingCents?: number;
	fees?: FeeModel;
}

/* ─────────────────────── Lifecycle (Phase 3 + Phase 4) ─────────────────────── */

/**
 * Output of `recommendListPrice` — the recommended list price plus the
 * expected outcomes at that price. Returns null when the market lacks
 * a velocity signal (`salesPerDay <= 0`).
 *
 * Time prediction follows Erlang(k = queueAhead + 1, λ = salesPerDay):
 * mean = k/λ, σ = √k/λ. The ±σ band approximates a 68% CI; in fast or
 * narrow markets the band collapses, in slow / large-queue markets it
 * widens — honest about uncertainty rather than projecting a false
 * point estimate.
 */
export interface ListPriceRecommendation {
	listPriceCents: number;
	/** Mean days-to-sell at `listPriceCents` under the queue model. */
	expectedDaysToSell: number;
	/** Lower edge of ±σ Erlang band (floored at 0.5d). */
	daysLow: number;
	/** Upper edge of ±σ Erlang band. */
	daysHigh: number;
	/** Net cents at this list price (sale − fees − shipping − buy). */
	netCents: number;
	/** Capital efficiency in cents/day = netCents / expectedDaysToSell. */
	dollarsPerDay: number;
	/** Realistic asks at or below `listPriceCents` (in queue ahead of mine). */
	queueAhead: number;
	/** Realistic asks above `listPriceCents` (room above me). */
	asksAbove: number;
}
