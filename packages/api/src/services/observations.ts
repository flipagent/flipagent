/**
 * Per-listing observation recorder + cache reader. Two roles for one
 * table (`listing_observations` / `product_observations`):
 *
 *   1. **ML / dataset lake** — every fetch lands as an append-only row
 *      with denormalised analytic columns (price, condition, seller,
 *      aspects). Powers calibration regressions + matcher iteration.
 *
 *   2. **Runtime cache** — detail/product fetches additionally store
 *      the full normalised body in `raw_response`/`snapshot`. The
 *      `getFreshDetailObservation` / `getFreshProduct` readers find
 *      the latest fresh row and short-circuit upstream calls. The
 *      data lake IS the cache — single source of truth.
 *
 * Gating:
 *   - `recordSearchObservations` is gated by `OBSERVATION_ENABLED`
 *     (volume — search results, sold-search batches), so self-host
 *     defaults off.
 *   - `recordDetailObservation` and `recordProductObservation` are
 *     **always-on** because they double as runtime cache. Self-host
 *     accumulates one row per detail/product fetch (small; can be
 *     pruned via maintenance sweep if storage matters).
 *
 * ToS posture:
 *   - `itemWebUrl` is required on every row (always link back).
 *   - `imageUrl` stores eBay's CDN URL only — we never mirror binaries.
 *   - `/v1/takedown` flips `takedown_at`; live queries skip those rows
 *     so cache misses on takedown'd items, forcing the request handler
 *     to surface the takedown.
 *   - `seller_username` is captured for reputation analytics; sellers
 *     opting out via `/v1/takedown` are propagated.
 */

import { createHash } from "node:crypto";
import type { EbayCatalogProduct } from "@flipagent/types";
import type { ItemDetail } from "@flipagent/types/ebay/buy";
import { and, desc, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/client.js";
import {
	categorySnapshots,
	listingObservations,
	type NewListingObservation,
	productObservations,
} from "../db/schema.js";
import { toLegacyId } from "../utils/item-id.js";
import { toCentsOrNull } from "./shared/money.js";

export interface ObservationContext {
	marketplace?: string; // default "ebay_us"
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
 * Record one detail-level observation. Always-on (no
 * `OBSERVATION_ENABLED` gate) because the row doubles as runtime cache
 * — `getFreshDetailObservation` reads `raw_response` to skip upstream.
 *
 * `rawResponse` should be the flipagent-normalised `ItemDetail` body
 * (transport-uniform). `source` records which transport produced it
 * for telemetry; the read path can filter on it when callers need
 * source-specific cache (e.g. flipping `EBAY_DETAIL_SOURCE` between
 * scrape/REST shouldn't serve a stale cross-source row).
 */
export async function recordDetailObservation(
	detail: ObservableItem,
	ctx: ObservationContext & { rawResponse?: object; source?: "rest" | "scrape" | "bridge" } = {},
): Promise<void> {
	const row = buildRow(detail, ctx);
	if (!row) return;
	if (ctx.rawResponse !== undefined) row.rawResponse = ctx.rawResponse as object;
	if (ctx.source !== undefined) row.source = ctx.source;
	try {
		await db.insert(listingObservations).values(row);
	} catch (err) {
		console.error("[observations] detail insert failed:", err);
	}
}

/**
 * Cache reader — finds the latest fresh `raw_response` row and returns
 * its body. Backs the lake-as-cache pattern in `services/items/detail.ts`:
 * a hit short-circuits transport selection and upstream entirely, a
 * miss falls through to the existing dispatch + write path.
 *
 * `ttlMs` aligns with `DETAIL_TTL_SEC` at the call site (4h default).
 * `itemId` filter (full v1|legacy|variation form) ensures different
 * SKUs of the same parent don't poison each other's cache. `source`
 * filter prevents cross-transport leakage (REST has fields scrape
 * doesn't, etc.).
 */
export async function getFreshDetailObservation(
	legacyId: string,
	ttlMs: number,
	options: { itemId?: string; source?: "rest" | "scrape" | "bridge"; marketplace?: string } = {},
): Promise<{ body: ItemDetail; source: string; observedAt: Date } | null> {
	try {
		const cutoff = new Date(Date.now() - ttlMs);
		const filters = [
			eq(listingObservations.marketplace, options.marketplace ?? "ebay_us"),
			eq(listingObservations.legacyItemId, legacyId),
			isNotNull(listingObservations.rawResponse),
			isNull(listingObservations.takedownAt),
			gt(listingObservations.observedAt, cutoff),
		];
		if (options.itemId) filters.push(eq(listingObservations.itemId, options.itemId));
		if (options.source) filters.push(eq(listingObservations.source, options.source));
		const rows = await db
			.select({
				rawResponse: listingObservations.rawResponse,
				source: listingObservations.source,
				observedAt: listingObservations.observedAt,
			})
			.from(listingObservations)
			.where(and(...filters))
			.orderBy(desc(listingObservations.observedAt))
			.limit(1);
		const row = rows[0];
		if (!row || !row.rawResponse) return null;
		return {
			body: row.rawResponse as ItemDetail,
			source: row.source ?? "unknown",
			observedAt: row.observedAt,
		};
	} catch (err) {
		console.warn("[observations] detail cache read failed:", (err as Error).message);
		return null;
	}
}

/**
 * Cache reader for catalog products — analogous to
 * `getFreshDetailObservation` but reads `product_observations.snapshot`
 * (full `Product` JSONB). Used by `getProductByEpid` to skip upstream
 * when a fresh row exists.
 */
export async function getFreshProduct(
	epid: string,
	ttlMs: number,
	marketplace = "ebay_us",
): Promise<{ body: EbayCatalogProduct; source: string; observedAt: Date } | null> {
	try {
		const cutoff = new Date(Date.now() - ttlMs);
		const rows = await db
			.select({
				snapshot: productObservations.snapshot,
				source: productObservations.source,
				observedAt: productObservations.observedAt,
			})
			.from(productObservations)
			.where(
				and(
					eq(productObservations.marketplace, marketplace),
					eq(productObservations.epid, epid),
					isNull(productObservations.takedownAt),
					gt(productObservations.observedAt, cutoff),
				),
			)
			.orderBy(desc(productObservations.observedAt))
			.limit(1);
		const row = rows[0];
		if (!row) return null;
		return {
			body: row.snapshot as EbayCatalogProduct,
			source: row.source,
			observedAt: row.observedAt,
		};
	} catch (err) {
		console.warn("[observations] product cache read failed:", (err as Error).message);
		return null;
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

/**
 * Append-only catalog product capture. Always-on — like
 * `recordDetailObservation`, the row doubles as runtime cache via
 * `getFreshProduct`, so self-host needs the writes too.
 *
 * Stores the full `Product` body as JSONB. Schema-free for forward-
 * compat: future Product field additions don't need migrations.
 */
export async function recordProductObservation(
	product: EbayCatalogProduct,
	source: "rest" | "scrape",
	marketplace = "ebay_us",
): Promise<void> {
	if (!product.epid) return;
	try {
		await db.insert(productObservations).values({
			marketplace,
			epid: product.epid,
			snapshot: product as object,
			source,
		});
	} catch (err) {
		console.error("[observations] product insert failed:", err);
	}
}

/**
 * Change-only catalog snapshot. eBay revs categories quarterly-ish and
 * the trees are large (hundreds of KB), so unconditional inserts on
 * every taxonomy fetch would burn storage. We hash the canonical-JSON
 * snapshot and only insert when the hash differs from the latest row
 * for `(marketplace, root)`. Designed to be called from a periodic
 * taxonomy sync job (daily or per-deploy), not from request-time
 * fetches.
 *
 * `root` = the subtree root id (or `"0"` for the full tree).
 */
export async function recordCategorySnapshot(
	root: string,
	snapshot: unknown,
	marketplace = "ebay_us",
): Promise<{ inserted: boolean }> {
	if (!config.OBSERVATION_ENABLED) return { inserted: false };
	const canonical = JSON.stringify(snapshot);
	const hash = createHash("sha256").update(canonical).digest("hex");
	try {
		const [latest] = await db
			.select({ hash: categorySnapshots.hash })
			.from(categorySnapshots)
			.where(and(eq(categorySnapshots.marketplace, marketplace), eq(categorySnapshots.root, root)))
			.orderBy(desc(categorySnapshots.observedAt))
			.limit(1);
		if (latest?.hash === hash) return { inserted: false };
		await db.insert(categorySnapshots).values({
			marketplace,
			root,
			hash,
			snapshot: snapshot as object,
		});
		return { inserted: true };
	} catch (err) {
		console.error("[observations] category snapshot insert failed:", err);
		return { inserted: false };
	}
}

function buildRow(item: ObservableItem, ctx: ObservationContext): NewListingObservation | null {
	if (!item.itemWebUrl) return null; // attribution missing → skip
	const legacyId = toLegacyId(item);
	if (!legacyId) return null;

	const aspects = item.localizedAspects;

	return {
		marketplace: ctx.marketplace ?? "ebay_us",
		legacyItemId: legacyId,
		itemId: item.itemId,
		sourceQueryHash: ctx.queryHash,
		itemWebUrl: item.itemWebUrl,
		title: item.title ?? null,
		condition: item.condition ?? null,
		conditionId: item.conditionId ?? null,
		priceCents: toCentsOrNull(item.price?.value),
		currency: item.price?.currency ?? "USD",
		shippingCents: toCentsOrNull(item.shippingOptions?.[0]?.shippingCost?.value),
		lastSoldPriceCents: toCentsOrNull(item.lastSoldPrice?.value),
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
