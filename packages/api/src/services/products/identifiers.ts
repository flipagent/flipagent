/**
 * External-key → catalog (`product_id`, `variant_id?`) lookup.
 *
 * The unique index `(marketplace, kind, value)` makes every read here
 * an indexed point-lookup. Writers (`upsert.ts`) add identifiers when
 * a Product is created or merged; readers (`resolve.ts`) hit this
 * table first before falling back to title fuzzy match.
 */

import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { type ProductIdentifier, productIdentifiers } from "../../db/schema.js";

export type IdentifierKind = "epid" | "gtin" | "mpn" | "sku" | "stockx_id" | "goat_id";

export interface IdentifierLookup {
	marketplace: string;
	kind: IdentifierKind;
	value: string;
}

export interface IdentifierResolution {
	productId: string;
	variantId: string | null;
}

/** Single-shot lookup. Returns null when no row matches. */
export async function findByIdentifier(input: IdentifierLookup): Promise<IdentifierResolution | null> {
	const rows = await db
		.select({
			productId: productIdentifiers.productId,
			variantId: productIdentifiers.variantId,
		})
		.from(productIdentifiers)
		.where(
			and(
				eq(productIdentifiers.marketplace, input.marketplace),
				eq(productIdentifiers.kind, input.kind),
				eq(productIdentifiers.value, input.value),
			),
		)
		.limit(1);
	const row = rows[0];
	if (!row) return null;
	return { productId: row.productId, variantId: row.variantId };
}

/**
 * Try every supplied identifier in priority order, return the first
 * resolution. Used during ProductRef resolution: when an eBay listing
 * carries epid + gtin, we prefer marketplace-scoped epid (most specific)
 * but fall back to global gtin if epid isn't on file yet.
 */
export async function findFirstByIdentifiers(
	candidates: ReadonlyArray<IdentifierLookup>,
): Promise<IdentifierResolution | null> {
	for (const c of candidates) {
		const hit = await findByIdentifier(c);
		if (hit) return hit;
	}
	return null;
}

/**
 * Attach an identifier to an existing product+variant. Idempotent —
 * a duplicate `(marketplace, kind, value)` triggers ON CONFLICT DO
 * NOTHING (the unique index enforces single-tenancy).
 */
export interface AttachIdentifierInput {
	productId: string;
	variantId?: string | null;
	marketplace: string;
	kind: IdentifierKind;
	value: string;
}

export async function attachIdentifier(input: AttachIdentifierInput): Promise<void> {
	await db
		.insert(productIdentifiers)
		.values({
			productId: input.productId,
			variantId: input.variantId ?? null,
			marketplace: input.marketplace,
			kind: input.kind,
			value: input.value,
		})
		.onConflictDoNothing({
			target: [productIdentifiers.marketplace, productIdentifiers.kind, productIdentifiers.value],
		});
}

/** All identifiers for a product, for surface render or audit. */
export async function listIdentifiers(productId: string): Promise<ProductIdentifier[]> {
	return await db.select().from(productIdentifiers).where(eq(productIdentifiers.productId, productId));
}
