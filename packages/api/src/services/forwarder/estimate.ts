/**
 * Top-level US-domestic forwarder fee estimator. Composes provider rate
 * lookup, dim-weight resolution, and handling fees into a single quote.
 */

import { getProvider } from "./providers/index.js";
import type {
	CarrierService,
	ForwarderInputs,
	ForwarderProvider,
	ForwarderQuote,
	ForwarderShippingRate,
	ZoneBand,
} from "./types.js";
import { zoneBandFor } from "./zones.js";

const ETA_BY_SERVICE_BAND: Record<CarrierService, Record<ZoneBand, [number, number]>> = {
	usps_priority: {
		local: [1, 2],
		west: [2, 3],
		central: [2, 3],
		east: [3, 4],
		offshore: [3, 5],
	},
	usps_ground_advantage: {
		local: [2, 3],
		west: [3, 5],
		central: [4, 6],
		east: [5, 7],
		offshore: [5, 8],
	},
	ups_ground: {
		local: [1, 2],
		west: [2, 3],
		central: [3, 4],
		east: [4, 5],
		offshore: [7, 14],
	},
	fedex_home: {
		local: [1, 2],
		west: [2, 3],
		central: [3, 4],
		east: [4, 5],
		offshore: [7, 14],
	},
};

/** Volumetric weight in grams from a bounding box, given the provider's divisor. */
export function dimWeightG(dims: { l: number; w: number; h: number }, dimDivisor: number): number {
	const cm3 = dims.l * dims.w * dims.h;
	return Math.round((cm3 / dimDivisor) * 1000);
}

function lookupRate(rates: ForwarderShippingRate[], weightG: number): ForwarderShippingRate | null {
	for (const row of rates) {
		if (weightG >= row.minWeightG && weightG < row.maxWeightG) return row;
	}
	const last = rates[rates.length - 1];
	if (last && weightG >= last.maxWeightG) return last;
	return null;
}

function resolveRateTable(
	provider: ForwarderProvider,
	service: CarrierService,
	band: ZoneBand,
): ForwarderShippingRate[] | null {
	return provider.rateTables[`${service}:${band}`] ?? null;
}

/**
 * Main entry. Returns a quote with handling + shipping broken out.
 *
 * @example
 * ```ts
 * import { estimateForwarderFee } from "./estimate.js";
 *
 * const quote = estimateForwarderFee("planet-express", {
 *   weightG: 1400,
 *   destState: "NY",
 *   itemCount: 2,
 * });
 *
 * console.log(quote.totalCents, quote.breakdown);
 * ```
 */
export function estimateForwarderFee(providerId: string, input: ForwarderInputs): ForwarderQuote {
	const provider = getProvider(providerId);
	const service = input.service ?? provider.defaultService;
	const itemCount = input.itemCount ?? 1;
	const band = zoneBandFor(provider.originState, input.destState);

	const dimW = input.dimsCm ? dimWeightG(input.dimsCm, provider.dimDivisor) : 0;
	const chargeable = Math.max(input.weightG, dimW);

	const table = resolveRateTable(provider, service, band);
	if (!table) {
		throw new Error(`No rate table for ${provider.id} ${service} → ${band}`);
	}
	const row = lookupRate(table, chargeable);
	if (!row) {
		throw new Error(`No rate row for ${chargeable}g on ${provider.id} ${service} ${band}`);
	}

	const handlingCents =
		provider.handlingCents +
		Math.max(0, itemCount - 1) * provider.perExtraItemCents +
		(itemCount >= 2 ? provider.consolidationCents : 0);

	const caveats: string[] = [];
	if (dimW > input.weightG) {
		caveats.push(`Billed on dim weight ${chargeable}g (actual ${input.weightG}g).`);
	}
	if (band === "offshore" && (service === "ups_ground" || service === "fedex_home")) {
		caveats.push(`${service} typically does not serve AK/HI — prefer USPS Priority.`);
	}

	const breakdown = [
		`Handling (${itemCount} item${itemCount === 1 ? "" : "s"}): $${(handlingCents / 100).toFixed(2)}`,
		`Shipping ${service.replace(/_/g, " ")} ${chargeable}g → ${input.destState} (${band}): $${(row.costCents / 100).toFixed(2)}`,
	];

	return {
		providerId: provider.id,
		service,
		zoneBand: band,
		chargeableWeightG: chargeable,
		handlingCents,
		shippingCents: row.costCents,
		totalCents: handlingCents + row.costCents,
		breakdown,
		etaDays: ETA_BY_SERVICE_BAND[service][band],
		caveats,
	};
}
