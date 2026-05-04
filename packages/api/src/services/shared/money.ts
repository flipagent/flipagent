/**
 * Money conversion at the eBay-wire ↔ flipagent boundary.
 *
 * eBay's REST + Trading APIs use dollar strings (`"12.99"`); flipagent's
 * public surface uses cents-int Money (`{value: 1299, currency: "USD"}`).
 * Conversion happens at the service-transformer layer — once here,
 * never in route handlers, never in scoring code.
 *
 * Round, not floor: a `12.345` dollar string becomes 1235 cents.
 */

import type { Money } from "@flipagent/types";

/** eBay dollar string → cents-int. `null`/`undefined`/empty → 0. */
export function toCents(s: string | undefined | null): number {
	if (!s) return 0;
	const n = Number.parseFloat(s);
	return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/**
 * Same as `toCents` but preserves "no value" — empty/invalid → `null`.
 * Use when missing-vs-zero is a meaningful distinction (e.g. analytics
 * rows where 0 would be misread as a real $0 price).
 */
export function toCentsOrNull(s: string | undefined | null): number | null {
	if (s == null || s === "") return null;
	const n = Number.parseFloat(s);
	return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** cents-int → eBay dollar string with two decimals. */
export function toDollarString(cents: number): string {
	return (cents / 100).toFixed(2);
}

interface EbayAmount {
	value?: string | null;
	/** eBay sometimes uses `currency`, sometimes `currencyCode`. Accept both. */
	currency?: string | null;
	currencyCode?: string | null;
}

/**
 * Build a flipagent `Money` from an eBay-shape `{value, currency}` row.
 * Returns `undefined` when the input is missing or empty so callers can
 * spread-omit cleanly: `...(money(x) ? { price: money(x) } : {})`.
 */
export function moneyFrom(input: EbayAmount | null | undefined): Money | undefined {
	if (!input?.value) return undefined;
	return { value: toCents(input.value), currency: input.currency ?? input.currencyCode ?? "USD" };
}

/** Same as `moneyFrom` but defaults missing inputs to zero — for required price fields. */
export function moneyFromOrZero(input: EbayAmount | null | undefined): Money {
	return moneyFrom(input) ?? { value: 0, currency: "USD" };
}

/** Build the eBay-shape `{value, currency}` row from a flipagent `Money`. */
export function moneyToEbay(m: Money): { value: string; currency: string } {
	return { value: toDollarString(m.value), currency: m.currency };
}
