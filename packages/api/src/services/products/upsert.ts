/**
 * Catalog write path. Pure DB ops — Product / Variant inserts, attribute
 * merges, takedown markers. Stays decoupled from resolution logic
 * (`resolve.ts` calls into here once it's decided what to write).
 */

import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
	type Product as ProductRow,
	products,
	productVariants,
	type ProductVariant as VariantRow,
} from "../../db/schema.js";
import { variantKey as canonicalVariantKey, newProductId, newVariantId } from "./keys.js";

export interface CreateProductInput {
	title: string;
	brand?: string | null;
	modelNumber?: string | null;
	categoryPath?: string | null;
	catalogStatus?: "curated" | "auto" | "pending";
	attributes?: Record<string, unknown>;
	hasVariants?: boolean;
}

export async function createProduct(input: CreateProductInput): Promise<ProductRow> {
	const id = newProductId();
	const [row] = await db
		.insert(products)
		.values({
			id,
			title: input.title,
			brand: input.brand ?? null,
			modelNumber: input.modelNumber ?? null,
			categoryPath: input.categoryPath ?? null,
			catalogStatus: input.catalogStatus ?? "auto",
			attributes: (input.attributes ?? {}) as object,
			hasVariants: input.hasVariants ?? false,
		})
		.returning();
	if (!row) throw new Error("products insert returned no row");
	return row;
}

export async function getProduct(id: string): Promise<ProductRow | null> {
	const rows = await db.select().from(products).where(eq(products.id, id)).limit(1);
	return rows[0] ?? null;
}

export async function listVariants(productId: string): Promise<VariantRow[]> {
	return await db.select().from(productVariants).where(eq(productVariants.productId, productId));
}

export interface UpsertVariantInput {
	productId: string;
	attributes: Record<string, string>;
}

/**
 * Upsert a Variant for `(productId, canonical(attributes))`. Returns
 * the existing row when the canonical key already exists, otherwise
 * inserts a new one. Sets `products.has_variants = true` on first
 * variant insert so downstream digest logic can branch on it without
 * a count(*).
 */
export async function upsertVariant(input: UpsertVariantInput): Promise<VariantRow> {
	const key = canonicalVariantKey(input.attributes);
	if (!key) throw new Error("upsertVariant called with empty attributes");

	const existing = await db
		.select()
		.from(productVariants)
		.where(and(eq(productVariants.productId, input.productId), eq(productVariants.variantKey, key)))
		.limit(1);
	if (existing[0]) return existing[0];

	const id = newVariantId();
	const [row] = await db
		.insert(productVariants)
		.values({
			id,
			productId: input.productId,
			variantKey: key,
			attributes: input.attributes as object,
		})
		.onConflictDoNothing({ target: [productVariants.productId, productVariants.variantKey] })
		.returning();

	// Race fallback: a concurrent inserter won the unique-index race; re-read.
	if (!row) {
		const [rerun] = await db
			.select()
			.from(productVariants)
			.where(and(eq(productVariants.productId, input.productId), eq(productVariants.variantKey, key)))
			.limit(1);
		if (!rerun) throw new Error("upsertVariant: insert lost race AND re-read failed");
		return rerun;
	}

	// Flip has_variants once.
	await db.update(products).set({ hasVariants: true, updatedAt: new Date() }).where(eq(products.id, input.productId));
	return row;
}

/** Patch top-level Product fields. Used by catalog merges + manual curation. */
export interface UpdateProductInput {
	id: string;
	title?: string;
	brand?: string | null;
	modelNumber?: string | null;
	categoryPath?: string | null;
	catalogStatus?: "curated" | "auto" | "pending";
	attributes?: Record<string, unknown>;
}

export async function updateProduct(input: UpdateProductInput): Promise<ProductRow | null> {
	const updates: Record<string, unknown> = { updatedAt: new Date() };
	if (input.title !== undefined) updates.title = input.title;
	if (input.brand !== undefined) updates.brand = input.brand;
	if (input.modelNumber !== undefined) updates.modelNumber = input.modelNumber;
	if (input.categoryPath !== undefined) updates.categoryPath = input.categoryPath;
	if (input.catalogStatus !== undefined) updates.catalogStatus = input.catalogStatus;
	if (input.attributes !== undefined) updates.attributes = input.attributes;
	const [row] = await db.update(products).set(updates).where(eq(products.id, input.id)).returning();
	return row ?? null;
}

export async function takedownProduct(id: string): Promise<void> {
	await db.update(products).set({ takedownAt: new Date(), updatedAt: new Date() }).where(eq(products.id, id));
}
