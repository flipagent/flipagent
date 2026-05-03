/**
 * sell/metadata/v1/marketplace/{id}/get_digital_signature_routes —
 * routes that require digital-signature delivery (eBay-issued labels).
 */

import type { DigitalSignatureRoute } from "@flipagent/types";
import { sellRequest, swallowEbay404 } from "../ebay/rest/user-client.js";
import { toCents } from "../shared/money.js";

const COUNTRY_TO_EBAY: Record<string, string> = {
	US: "EBAY_US",
	GB: "EBAY_GB",
	DE: "EBAY_DE",
	AU: "EBAY_AU",
	CA: "EBAY_CA",
	FR: "EBAY_FR",
	IT: "EBAY_IT",
	ES: "EBAY_ES",
};

interface EbayRoutes {
	digitalSignatureRoutes?: Array<{
		fromCountry: string;
		toCountry: string;
		signatureRequired: boolean;
		thresholdAmount?: { value: string; currency: string };
	}>;
}

export async function getDigitalSignatureRoutes(
	country: string,
	apiKeyId: string,
): Promise<{ routes: DigitalSignatureRoute[] }> {
	const m = COUNTRY_TO_EBAY[country.toUpperCase()] ?? "EBAY_US";
	const res = await sellRequest<EbayRoutes>({
		apiKeyId,
		method: "GET",
		path: `/sell/metadata/v1/marketplace/${m}/get_digital_signature_routes`,
	}).catch(swallowEbay404);
	return {
		routes: (res?.digitalSignatureRoutes ?? []).map((r) => ({
			fromCountry: r.fromCountry,
			toCountry: r.toCountry,
			signatureRequired: r.signatureRequired,
			...(r.thresholdAmount
				? { thresholdAmount: { value: toCents(r.thresholdAmount.value), currency: r.thresholdAmount.currency } }
				: {}),
		})),
	};
}
