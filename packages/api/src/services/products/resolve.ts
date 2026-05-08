/**
 * `ProductRef → Product` resolver. Universal entry point for any service
 * that needs to know which catalog Product a query / listing / id refers
 * to. Three input flavors, three resolution paths:
 *
 *   - `id`       — direct product+variant lookup
 *   - `external` — marketplace listing → identifiers index → Product;
 *                  on miss, fetch detail and auto-create
 *   - `query`    — catalog text search (trigram on title/brand) →
 *                  candidates; if exactly one strong match, return it,
 *                  otherwise fall back to a marketplace search and
 *                  auto-create from the top result
 *
 * The matcher's verify step is skipped at this layer — catalog resolve
 * is a *binding* operation, not a comp-pool curation. The downstream
 * market-data pipeline still runs the matcher to clean per-marketplace
 * pools against the resolved product.
 */

import type { ItemDetail } from "@flipagent/types/ebay/buy";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import type { ApiKey } from "../../db/schema.js";
import {
	type Product as ProductRow,
	products,
	productVariants,
	type ProductVariant as VariantRow,
} from "../../db/schema.js";
import { parseItemId } from "../../utils/item-id.js";
import { getItemDetail } from "../items/detail.js";
import { MultiVariationParentError } from "../items/errors.js";
import { searchActiveListings } from "../items/search.js";
import { EvaluateError } from "../market-data/pipeline.js";
import { attachIdentifier, findFirstByIdentifiers, type IdentifierKind } from "./identifiers.js";
import { variantKey as canonicalVariantKey } from "./keys.js";
import { createProduct, upsertVariant } from "./upsert.js";

export type Marketplace = string;

export type ProductRefInput =
	| { kind: "id"; productId: string; variantId?: string }
	| { kind: "external"; marketplace: Marketplace; listingId: string }
	| {
			kind: "query";
			q: string;
			hints?: { size?: string; color?: string; condition?: string; marketplace?: Marketplace };
	  };

export interface ResolveResult {
	outcome: "matched" | "created" | "ambiguous";
	product?: ProductRow;
	variant?: VariantRow | null;
	candidates?: { product: ProductRow; variant: VariantRow | null; confidence: number; reason: string }[];
	/** Anchor listing detail when resolution went through an external listing. */
	anchorDetail?: ItemDetail;
	/** Where the resolution landed in the search hierarchy — for trace. */
	via?: "id" | "identifier" | "trgm" | "marketplace_anchor" | "auto_create";
}

export interface ResolveContext {
	apiKey?: ApiKey;
	/** When false, never auto-create — return ambiguous + empty candidates instead. */
	allowAutoCreate?: boolean;
}

export class CatalogResolveError extends Error {
	constructor(
		readonly code: "id_not_found" | "listing_not_found" | "no_query" | "no_match",
		readonly status: 400 | 404,
		message: string,
	) {
		super(message);
		this.name = "CatalogResolveError";
	}
}

export async function resolveProductRef(ref: ProductRefInput, ctx: ResolveContext = {}): Promise<ResolveResult> {
	const allowAutoCreate = ctx.allowAutoCreate ?? true;
	if (ref.kind === "id") return await resolveById(ref);
	if (ref.kind === "external") return await resolveExternal(ref, ctx, allowAutoCreate);
	return await resolveQuery(ref, ctx, allowAutoCreate);
}

/* --------------------------------- by id --------------------------------- */

async function resolveById(ref: { kind: "id"; productId: string; variantId?: string }): Promise<ResolveResult> {
	const [product] = await db.select().from(products).where(eq(products.id, ref.productId)).limit(1);
	if (!product) {
		throw new CatalogResolveError("id_not_found", 404, `No product ${ref.productId}.`);
	}
	let variant: VariantRow | null = null;
	if (ref.variantId) {
		const [v] = await db
			.select()
			.from(productVariants)
			.where(and(eq(productVariants.id, ref.variantId), eq(productVariants.productId, ref.productId)))
			.limit(1);
		if (!v) {
			throw new CatalogResolveError(
				"id_not_found",
				404,
				`Variant ${ref.variantId} not found on product ${ref.productId}.`,
			);
		}
		variant = v;
	}
	return { outcome: "matched", product, variant, via: "id" };
}

/* ------------------------------- external ------------------------------- */

async function resolveExternal(
	ref: { kind: "external"; marketplace: Marketplace; listingId: string },
	ctx: ResolveContext,
	allowAutoCreate: boolean,
): Promise<ResolveResult> {
	// Normalize listingId — accept full eBay /itm/ URL too.
	const parsed = parseItemId(ref.listingId);
	const legacyId = parsed?.legacyId ?? ref.listingId;
	const variationId = parsed?.variationId;

	// Step 1: detail-first. We fetch the listing detail before any
	// identifier shortcut because:
	//   1. Multi-SKU parent detection runs against the detail body.
	//      The eBay REST transport raises MultiVariationParentError;
	//      scrape/bridge return the page-default-rendered variation
	//      with `variations[]` populated. Catching either here keeps
	//      the variation guard at the catalog boundary regardless of
	//      whether the catalog already knows this listing.
	//   2. Downstream consumers (market-data pipeline, evaluate scoring)
	//      need the detail anyway as the matcher anchor, so this isn't
	//      extra IO — just earlier in the call.
	let detailResult: Awaited<ReturnType<typeof getItemDetail>>;
	try {
		detailResult = await getItemDetail(legacyId, { apiKey: ctx.apiKey, variationId });
	} catch (err) {
		if (err instanceof MultiVariationParentError) {
			throw new EvaluateError(
				"variation_required",
				422,
				`Listing ${err.legacyId} is a multi-SKU parent with ${err.variations.length} variations; retry with a specific variationId.`,
				{ legacyId: err.legacyId, variations: err.variations },
			);
		}
		throw err;
	}
	if (!detailResult) {
		throw new CatalogResolveError("listing_not_found", 404, `Listing ${legacyId} not found on ${ref.marketplace}.`);
	}
	const detail = detailResult.body;
	if (!variationId) {
		const detailBody = detail as {
			variations?: ReadonlyArray<unknown>;
			image?: { imageUrl?: string };
			title?: string;
		};
		if (detailBody.variations && detailBody.variations.length > 0) {
			throw new EvaluateError(
				"variation_required",
				422,
				`Listing ${legacyId} is a multi-SKU parent with ${detailBody.variations.length} variations; retry with a specific variationId.`,
				{
					legacyId,
					variations: detailBody.variations,
					...(detailBody.image?.imageUrl ? { parentImageUrl: detailBody.image.imageUrl } : {}),
					...(detailBody.title ? { parentTitle: detailBody.title } : {}),
				},
			);
		}
	}

	// Step 2: identifier shortcut on the now-fetched detail. Marketplace
	// SKU is the cheapest hit; epid / gtin / mpn cover catalogs we know
	// about under different listings.
	const direct = await findFirstByIdentifiers([{ marketplace: ref.marketplace, kind: "sku", value: legacyId }]);
	if (direct) {
		const product = await getProductRow(direct.productId);
		if (!product) throw new Error(`stale identifier row points to deleted product ${direct.productId}`);
		const variant = direct.variantId ? await getVariantRow(direct.variantId) : null;
		return { outcome: "matched", product, variant, anchorDetail: detail, via: "identifier" };
	}

	// Step 3: try richer identifiers (epid / gtin) extracted from detail.
	const lookups: { marketplace: string; kind: IdentifierKind; value: string }[] = [];
	const epid = (detail as { epid?: string }).epid;
	if (epid) lookups.push({ marketplace: ref.marketplace, kind: "epid", value: epid });
	const gtin = (detail as { gtin?: string }).gtin;
	if (gtin) lookups.push({ marketplace: "global", kind: "gtin", value: gtin });
	const mpn = (detail as { mpn?: string }).mpn;
	if (mpn) lookups.push({ marketplace: "global", kind: "mpn", value: mpn });

	const richHit = lookups.length > 0 ? await findFirstByIdentifiers(lookups) : null;
	if (richHit) {
		const product = await getProductRow(richHit.productId);
		if (!product) throw new Error(`stale identifier row points to deleted product ${richHit.productId}`);
		// Attach the listing's marketplace SKU so future lookups short-circuit at step 1.
		await attachIdentifier({
			productId: richHit.productId,
			variantId: richHit.variantId,
			marketplace: ref.marketplace,
			kind: "sku",
			value: legacyId,
		});
		const variant = richHit.variantId ? await getVariantRow(richHit.variantId) : null;
		return { outcome: "matched", product, variant, anchorDetail: detail, via: "identifier" };
	}

	// Step 3: no identifier hit and no auto-create → bail.
	if (!allowAutoCreate) {
		return { outcome: "ambiguous", candidates: [], anchorDetail: detail };
	}

	// Step 4: auto-create from detail. Variant resolved from the listing's
	// own variation aspects (multi-SKU listings carry per-variation aspect
	// arrays); single-variation listings get product-level rows.
	const created = await autoCreateFromDetail({
		marketplace: ref.marketplace,
		listingId: legacyId,
		detail,
	});
	return {
		outcome: "created",
		product: created.product,
		variant: created.variant,
		anchorDetail: detail,
		via: "auto_create",
	};
}

interface AutoCreateInput {
	marketplace: Marketplace;
	listingId: string;
	detail: ItemDetail;
}

interface AutoCreateOutput {
	product: ProductRow;
	variant: VariantRow | null;
}

/**
 * Insert a Product (auto status) from listing detail. When the detail
 * carries variation aspects (eBay multi-SKU), upsert a variant row
 * keyed on those aspects. Identifiers are attached for every external
 * key the detail surfaces — epid, gtin, mpn, plus the listing's own SKU
 * — so the next lookup with any of those finds this product.
 */
async function autoCreateFromDetail(input: AutoCreateInput): Promise<AutoCreateOutput> {
	const detail = input.detail as ItemDetail & {
		epid?: string;
		gtin?: string;
		mpn?: string;
		brand?: string;
		categoryPath?: string;
		localizedAspects?: ReadonlyArray<{ name: string; value: string }>;
	};
	const product = await createProduct({
		title: detail.title,
		brand: detail.brand ?? null,
		modelNumber: detail.mpn ?? null,
		categoryPath: detail.categoryPath ?? null,
		catalogStatus: "auto",
		attributes: aspectsToAttributes(detail.localizedAspects),
	});

	// Variant inference — eBay multi-SKU listings expose per-variation
	// aspects but a `getItemDetail` for a specific `variationId` returns
	// that variation's aspects flat. We use Size + Color (the canonical
	// disambiguators) when present; absence means product-level row.
	const variantAttrs = pickVariantAttrs(detail.localizedAspects);
	let variant: VariantRow | null = null;
	if (Object.keys(variantAttrs).length > 0) {
		variant = await upsertVariant({ productId: product.id, attributes: variantAttrs });
	}

	const ids: { kind: IdentifierKind; value: string; marketplace: string }[] = [
		{ kind: "sku", marketplace: input.marketplace, value: input.listingId },
	];
	if (detail.epid) ids.push({ kind: "epid", marketplace: input.marketplace, value: detail.epid });
	if (detail.gtin) ids.push({ kind: "gtin", marketplace: "global", value: detail.gtin });
	if (detail.mpn) ids.push({ kind: "mpn", marketplace: "global", value: detail.mpn });
	for (const id of ids) {
		await attachIdentifier({ productId: product.id, variantId: variant?.id ?? null, ...id });
	}

	return { product, variant };
}

function aspectsToAttributes(
	aspects: ReadonlyArray<{ name: string; value: string }> | undefined,
): Record<string, unknown> {
	if (!aspects || aspects.length === 0) return {};
	const out: Record<string, string> = {};
	for (const a of aspects) {
		const name = a.name.trim().toLowerCase();
		if (!name) continue;
		out[name] = a.value;
	}
	return out;
}

const VARIANT_AXES = new Set(["size", "size (men's us)", "size (women's us)", "us shoe size", "color", "colour"]);

function pickVariantAttrs(aspects: ReadonlyArray<{ name: string; value: string }> | undefined): Record<string, string> {
	if (!aspects) return {};
	const out: Record<string, string> = {};
	for (const a of aspects) {
		const name = a.name.trim().toLowerCase();
		if (!VARIANT_AXES.has(name)) continue;
		// Normalize size axis names to a single 'size' slot.
		const slot = name.startsWith("size") || name.endsWith(" size") ? "size" : "color";
		out[slot] = a.value.trim();
	}
	return out;
}

/* --------------------------------- query --------------------------------- */

async function resolveQuery(
	ref: {
		kind: "query";
		q: string;
		hints?: { size?: string; color?: string; condition?: string; marketplace?: Marketplace };
	},
	ctx: ResolveContext,
	allowAutoCreate: boolean,
): Promise<ResolveResult> {
	const q = ref.q.trim();
	if (!q) throw new CatalogResolveError("no_query", 400, "Empty query.");

	// Step 1: trigram catalog search. Fast, indexed, exact when the
	// title is already in catalog.
	const trgmHits = await trigramSearch(q, 5);
	if (trgmHits.length === 1) {
		const product = trgmHits[0]!;
		const variant = await pickVariantByHints(product, ref.hints);
		return { outcome: "matched", product, variant, via: "trgm" };
	}
	if (trgmHits.length > 1) {
		// Multiple plausible — surface candidates for caller picker. Variant
		// pick happens after caller commits.
		const candidates = await Promise.all(
			trgmHits.map(async (p) => ({
				product: p,
				variant: await pickVariantByHints(p, ref.hints),
				confidence: 0.6, // trigram-only confidence
				reason: "title trigram match",
			})),
		);
		return { outcome: "ambiguous", candidates, via: "trgm" };
	}

	// Step 2: catalog miss → marketplace anchor search. Pick top relevance,
	// auto-create. The matcher will clean comp pools downstream against
	// this anchor's aspects.
	if (!allowAutoCreate) {
		throw new CatalogResolveError("no_match", 404, `No catalog product matched "${q}".`);
	}
	const marketplace = ref.hints?.marketplace ?? "ebay_us";
	const search = await searchActiveListings({ q, limit: 5 }, { apiKey: ctx.apiKey });
	const top = search.body.itemSummaries?.find((it) => !!it.title?.trim());
	if (!top) {
		throw new CatalogResolveError("no_match", 404, `Marketplace search returned no usable results for "${q}".`);
	}
	const legacyId = (top.legacyItemId ?? "").trim();
	if (!legacyId) {
		throw new CatalogResolveError("no_match", 404, `Top result for "${q}" lacks a usable listing id.`);
	}
	return await resolveExternal({ kind: "external", marketplace, listingId: legacyId }, ctx, true);
}

/**
 * Trigram fuzzy search on `products.title`. Returns at most `limit`
 * rows ranked by similarity. Filters out takedown'd rows.
 */
async function trigramSearch(q: string, limit: number): Promise<ProductRow[]> {
	// `similarity()` from pg_trgm; the GIN index makes this an indexed scan.
	// We pick a moderate threshold (0.3) — too low surfaces noise, too high
	// misses re-orderings.
	const rows = await db
		.select()
		.from(products)
		.where(and(isNull(products.takedownAt), sql`similarity(${products.title}, ${q}) > 0.3`))
		.orderBy(desc(sql`similarity(${products.title}, ${q})`), asc(products.createdAt))
		.limit(limit);
	return rows;
}

async function pickVariantByHints(
	product: ProductRow,
	hints: { size?: string; color?: string } | undefined,
): Promise<VariantRow | null> {
	if (!product.hasVariants || !hints) return null;
	const desired: Record<string, string> = {};
	if (hints.size) desired.size = hints.size;
	if (hints.color) desired.color = hints.color;
	if (Object.keys(desired).length === 0) return null;
	const targetKey = canonicalVariantKey(desired);
	const [v] = await db
		.select()
		.from(productVariants)
		.where(and(eq(productVariants.productId, product.id), eq(productVariants.variantKey, targetKey)))
		.limit(1);
	return v ?? null;
}

/* ------------------------------ row helpers ------------------------------ */

async function getProductRow(id: string): Promise<ProductRow | null> {
	const [row] = await db.select().from(products).where(eq(products.id, id)).limit(1);
	return row ?? null;
}

async function getVariantRow(id: string): Promise<VariantRow | null> {
	const [row] = await db.select().from(productVariants).where(eq(productVariants.id, id)).limit(1);
	return row ?? null;
}
