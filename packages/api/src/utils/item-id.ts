/**
 * Canonical eBay item-id helpers. Centralised so the v1 → legacy
 * translation rule lives in exactly one place — every route, service,
 * and worker that needs the numeric legacy id calls these.
 *
 * `itemId`  → `v1|<legacy>|<variationId>`  (Browse REST shape, what
 *                                summary/detail payloads carry)
 *                                The third segment is `0` for non-
 *                                variation listings or when the parent
 *                                listing is referenced; for a specific
 *                                variation of a multi-SKU listing
 *                                (sneakers / clothes / bags) it is the
 *                                eBay-assigned variation id.
 * `legacyItemId` → `<legacy>` (just the digits, what eBay's web URLs
 *                              + Marketplace Insights use)
 *
 * `parseItemId` is the canonical entry: accepts any of `v1|N|V`,
 * `v1|N|0`, bare `N`, or a full `https://www.ebay.com/itm/N?var=V`
 * URL, and returns `{ legacyId, variationId? }`. `variationId` is
 * carried through the detail-fetch path so REST / scrape / bridge
 * each pull the requested variation's price + aspects, instead of
 * eBay's default-rendered variation. `legacyFromV1` is the legacy
 * helper kept for callers that genuinely don't care about variations
 * (takedown, observation hashes).
 */

const V1_PREFIX = /^v1\|/;
const V1_SUFFIX = /\|\d+$/;
const V1_FORM = /^v1\|(\d{6,})\|(\d+)$/;

export interface ParsedItemId {
	legacyId: string;
	/** Variation id when the input carried one and it isn't the parent sentinel `"0"`. */
	variationId?: string;
}

/**
 * Parse any caller-provided id form into `{ legacyId, variationId? }`.
 *
 * Accepts:
 * - `v1|<legacyId>|<variationId>`   — `variationId` returned only if not `"0"`
 * - bare numeric `<legacyId>`        — variation absent
 * - full eBay URL                   — `https://www.ebay.com/itm/<n>` with optional `?var=<v>`
 *
 * Returns `null` when the input doesn't carry a recognisable 6+ digit
 * legacy id.
 */
export function parseItemId(input: string | null | undefined): ParsedItemId | null {
	if (!input) return null;
	const s = input.trim();
	if (!s) return null;

	// URL form. We only accept `/itm/<digits>` paths; query params come
	// from `URLSearchParams` so percent-encoding is handled.
	if (/^https?:\/\//i.test(s)) {
		try {
			const u = new URL(s);
			const m = u.pathname.match(/\/itm\/(?:[^/]+\/)?(\d{6,})/);
			if (!m) return null;
			const legacyId = m[1]!;
			const variationId = u.searchParams.get("var");
			return variationId && /^\d+$/.test(variationId) && variationId !== "0"
				? { legacyId, variationId }
				: { legacyId };
		} catch {
			return null;
		}
	}

	// v1|<legacy>|<variation> form.
	const v1 = V1_FORM.exec(s);
	if (v1) {
		const legacyId = v1[1]!;
		const variationId = v1[2]!;
		return variationId !== "0" ? { legacyId, variationId } : { legacyId };
	}

	// Bare numeric legacy id.
	if (/^\d{6,}$/.test(s)) return { legacyId: s };

	return null;
}

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
 * Strip the v1|...|<n> wrapper from a stringified itemId. Returns the
 * input unchanged when no wrapper is present (already legacy form).
 *
 * NOTE: discards the variation id. Use `parseItemId` when you need
 * the variation segment preserved (detail fetch, evaluate seed).
 */
export function legacyFromV1(itemId: string | null | undefined): string | null {
	if (!itemId) return null;
	return itemId.replace(V1_PREFIX, "").replace(V1_SUFFIX, "");
}
