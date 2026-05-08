/**
 * Catalog ID + variant-key utilities.
 *
 *   newProductId / newVariantId   — `prod_<32hex>` / `pvar_<32hex>`. Prefix
 *                                    keeps grep-ability and disambiguates
 *                                    from raw uuids in tracebacks. 32hex
 *                                    is `crypto.randomUUID()` minus dashes
 *                                    — same entropy, same wire size as
 *                                    other gen_random_uuid()-keyed rows.
 *
 *   variantKey(attributes)        — canonical key for `(product_id,
 *                                    variant_key)` uniqueness. Lower-case
 *                                    aspect names, alpha-sorted, `|`
 *                                    separated values. Same attributes
 *                                    in any order produce the same key.
 */

import { randomUUID } from "node:crypto";

const PRODUCT_PREFIX = "prod_";
const VARIANT_PREFIX = "pvar_";

function uuid32(): string {
	return randomUUID().replace(/-/g, "");
}

export function newProductId(): string {
	return `${PRODUCT_PREFIX}${uuid32()}`;
}

export function newVariantId(): string {
	return `${VARIANT_PREFIX}${uuid32()}`;
}

export function isProductId(s: string): boolean {
	return s.startsWith(PRODUCT_PREFIX);
}

export function isVariantId(s: string): boolean {
	return s.startsWith(VARIANT_PREFIX);
}

/**
 * Canonical variant key.
 *
 *   variantKey({ size: "10", color: "Mocha" })
 *     → "color:mocha|size:10"
 *
 * Lower-cases names + values, drops empty values, sorts by name. Pure;
 * same attribute object always maps to the same string. The DB unique
 * index `(product_id, variant_key)` relies on this — every writer and
 * reader must compute it through this function.
 */
export function variantKey(attributes: Record<string, string | number | undefined | null>): string {
	const parts: { name: string; value: string }[] = [];
	for (const [rawName, rawValue] of Object.entries(attributes)) {
		if (rawValue === undefined || rawValue === null) continue;
		const value = String(rawValue).trim();
		if (!value) continue;
		const name = rawName.trim().toLowerCase();
		if (!name) continue;
		parts.push({ name, value: value.toLowerCase() });
	}
	parts.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
	return parts.map((p) => `${p.name}:${p.value}`).join("|");
}

/** Decompose a variant key back into structured attributes. Inverse of `variantKey`. */
export function parseVariantKey(key: string): Record<string, string> {
	const out: Record<string, string> = {};
	if (!key) return out;
	for (const segment of key.split("|")) {
		const idx = segment.indexOf(":");
		if (idx <= 0) continue;
		const name = segment.slice(0, idx);
		const value = segment.slice(idx + 1);
		if (name && value) out[name] = value;
	}
	return out;
}
