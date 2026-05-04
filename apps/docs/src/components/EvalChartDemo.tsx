/**
 * EvalChartDemo — landing-page Card #02 visual.
 *
 * Renders the real `PriceHistogram` (the same component used in the
 * Evaluate playground result) against a hand-picked sold + active
 * comp set so the marketing card looks identical to what users see
 * in-product. The candidate price (`$37`) seeds the dashed "Your $37"
 * reference line so the chart tells a complete story: distribution
 * shape + buy target.
 *
 * Numbers are illustrative — no real eBay data here.
 */

import { PriceHistogram } from "./playground/PriceHistogram";
import type { ItemSummary } from "./playground/types";

const SOLD_PRICES: ReadonlyArray<number> = [
	36, 38, 40, 41, 42, 43, 44, 44, 45, 45, 46, 46, 47, 47,
	48, 48, 48, 48, 49, 49, 49, 49, 50, 50, 50, 51, 51, 52,
	52, 52, 53, 53, 54, 54, 55, 55, 56, 57, 58, 59, 60, 62,
];

const ACTIVE_PRICES: ReadonlyArray<number> = [
	45, 48, 50, 52, 52, 54, 55, 56, 58, 60, 62, 65,
];

function makeItem(price: number, i: number, kind: "sold" | "active"): ItemSummary {
	const money = { value: price.toFixed(2), currency: "USD" };
	const base = {
		itemId: `${kind}-${i}`,
		title: `Demo ${kind} ${i}`,
		itemWebUrl: "",
	};
	return kind === "sold"
		? { ...base, lastSoldPrice: money }
		: { ...base, price: money };
}

const sold = SOLD_PRICES.map((p, i) => makeItem(p, i, "sold"));
const active = ACTIVE_PRICES.map((p, i) => makeItem(p, i, "active"));

export default function EvalChartDemo() {
	return (
		<PriceHistogram
			sold={sold}
			active={active}
			candidatePriceCents={3700}
			bins={14}
		/>
	);
}
