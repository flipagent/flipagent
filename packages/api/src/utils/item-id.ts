/**
 * Canonical eBay item-id helpers. Centralised so the v1 → legacy
 * translation rule lives in exactly one place — every route, service,
 * and worker that needs the numeric legacy id calls these.
 *
 * `itemId`  → `v1|<legacy>|0`  (Browse REST shape, what summary/detail
 *                                payloads actually carry)
 * `legacyItemId` → `<legacy>` (just the digits, what eBay's web URLs
 *                              + Marketplace Insights use)
 */

const V1_PREFIX = /^v1\|/;
const V1_SUFFIX = /\|0$/;

/**
 * Pull the legacy numeric id off any object that carries either field.
 * Prefers `legacyItemId` when present; otherwise strips the v1 wrapper
 * off `itemId`. Returns the raw digits, or null when neither field
 * resolves to a 6+ digit numeric string.
 */
export function toLegacyId(item: { legacyItemId?: string | null; itemId?: string | null }): string | null {
	const candidate = item.legacyItemId ?? legacyFromV1(item.itemId);
	return candidate && /^\d{6,}$/.test(candidate) ? candidate : null;
}

/**
 * Strip the v1|...|0 wrapper from a stringified itemId. Returns the
 * input unchanged when no wrapper is present (already legacy form).
 */
export function legacyFromV1(itemId: string | null | undefined): string | null {
	if (!itemId) return null;
	return itemId.replace(V1_PREFIX, "").replace(V1_SUFFIX, "");
}
