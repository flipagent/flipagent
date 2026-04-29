/**
 * Per-listing observation recorder. Fire-and-forget hook called from
 * each `/v1/buy/browse/*` and `/v1/buy/marketplace_insights/item_sales/*` response
 * handler. Captures a snapshot of every listing the request returned,
 * tagged with the originating query so historical comparable lookups can
 * traverse forward (item history) or sideways (cohort behaviour).
 *
 * Hosted-only: gated by `config.OBSERVATION_ENABLED`. Self-host
 * deployments default off — they keep only the short-TTL proxy cache.
 *
 * ToS posture:
 *   - `itemWebUrl` is required on every row (always link back).
 *   - `imageUrl` stores eBay's CDN URL only — we never mirror binaries.
 *   - Existing seller takedowns set `takedownAt` so live queries skip
 *     the row without losing the audit trail.
 *   - `seller_username` is captured for reputation analytics; sellers
 *     opting out via `/v1/takedown` are propagated.
 */

import { config } from "../../config.js";
import { db } from "../../db/client.js";
import { listingObservations, type NewListingObservation } from "../../db/schema.js";
import { toLegacyId } from "../../utils/item-id.js";

export interface ObservationContext {
	marketplace?: string; // default "ebay"
	queryHash?: string;
}

/**
 * Record many summaries from a search response. Uses a single batch
 * insert; never throws into the caller — any DB hiccup logs and skips
 * (the request flow must not be blocked by archive writes).
 */
export async function recordSearchObservations(
	items: ReadonlyArray<ObservableItem>,
	ctx: ObservationContext = {},
): Promise<void> {
	if (!config.OBSERVATION_ENABLED) return;
	if (items.length === 0) return;
	const rows = items.map((item) => buildRow(item, ctx)).filter((r): r is NewListingObservation => r !== null);
	if (rows.length === 0) return;
	try {
		await db.insert(listingObservations).values(rows);
	} catch (err) {
		console.error("[observations] batch insert failed:", err);
	}
}

/**
 * Record one detail-level observation. Detail carries richer fields
 * (`localizedAspects`, `itemCreationDate`, etc) so the row is more
 * complete than a search-summary row.
 */
export async function recordDetailObservation(detail: ObservableItem, ctx: ObservationContext = {}): Promise<void> {
	if (!config.OBSERVATION_ENABLED) return;
	const row = buildRow(detail, ctx);
	if (!row) return;
	try {
		await db.insert(listingObservations).values(row);
	} catch (err) {
		console.error("[observations] detail insert failed:", err);
	}
}

/**
 * Loose superset of the fields we may pull off either ItemSummary or
 * ItemDetail. The two TypeBox shapes have non-overlapping optional
 * fields (`lastSoldPrice` is sold-search-only; `localizedAspects` is
 * detail-only), so the recorder treats both as a flat optional bag —
 * field-by-field guard whatever's present, ignore the rest.
 */
type ObservableItem = {
	itemId: string;
	itemWebUrl: string;
	legacyItemId?: string;
	title?: string;
	condition?: string;
	conditionId?: string;
	price?: { value: string; currency: string };
	shippingOptions?: ReadonlyArray<{ shippingCost?: { value: string; currency: string } }>;
	lastSoldPrice?: { value: string; currency: string };
	lastSoldDate?: string;
	seller?: { username?: string; feedbackScore?: number; feedbackPercentage?: string };
	categoryId?: string;
	categoryPath?: string;
	image?: { imageUrl: string };
	localizedAspects?: ReadonlyArray<{ name: string; value: string }>;
	itemCreationDate?: string;
	itemEndDate?: string;
};

function buildRow(item: ObservableItem, ctx: ObservationContext): NewListingObservation | null {
	if (!item.itemWebUrl) return null; // attribution missing → skip
	const legacyId = toLegacyId(item);
	if (!legacyId) return null;

	const aspects = item.localizedAspects;

	return {
		marketplace: ctx.marketplace ?? "ebay",
		legacyItemId: legacyId,
		itemId: item.itemId,
		sourceQueryHash: ctx.queryHash,
		itemWebUrl: item.itemWebUrl,
		title: item.title ?? null,
		condition: item.condition ?? null,
		conditionId: item.conditionId ?? null,
		priceCents: item.price ? toCents(item.price.value) : null,
		currency: item.price?.currency ?? "USD",
		shippingCents: item.shippingOptions?.[0]?.shippingCost
			? toCents(item.shippingOptions[0].shippingCost.value)
			: null,
		lastSoldPriceCents: item.lastSoldPrice ? toCents(item.lastSoldPrice.value) : null,
		lastSoldDate: item.lastSoldDate ? new Date(item.lastSoldDate) : null,
		sellerUsername: item.seller?.username ?? null,
		sellerFeedbackScore: item.seller?.feedbackScore ?? null,
		sellerFeedbackPercentage: item.seller?.feedbackPercentage ?? null,
		categoryId: item.categoryId ?? null,
		categoryPath: item.categoryPath ?? null,
		imageUrl: item.image?.imageUrl ?? null,
		aspects: aspects && aspects.length > 0 ? aspects : null,
		itemCreationDate: item.itemCreationDate ? new Date(item.itemCreationDate) : null,
		itemEndDate: item.itemEndDate ? new Date(item.itemEndDate) : null,
	};
}

function toCents(dollarString: string | undefined | null): number | null {
	if (dollarString == null || dollarString === "") return null;
	const n = Number.parseFloat(dollarString);
	if (!Number.isFinite(n)) return null;
	return Math.round(n * 100);
}
