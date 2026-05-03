/**
 * commerce/translation — title/description/aspects translation.
 */

import type { TranslateRequest, TranslateResponse } from "@flipagent/types";
import { config, isEbayAppConfigured } from "../config.js";
import { fetchRetry } from "../utils/fetch-retry.js";
import { getAppAccessToken } from "./ebay/oauth.js";

export async function translateText(input: TranslateRequest): Promise<TranslateResponse> {
	if (!isEbayAppConfigured()) throw new Error("ebay_not_configured");
	const token = await getAppAccessToken();
	// `v1_beta` is the live path — verified 2026-05-02. The previous
	// `v1` constant 404'd silently for the lifetime of this surface
	// (no callers had a way to surface the error since the route just
	// threw and the MCP tool's error envelope hid the path detail).
	const res = await fetchRetry(`${config.EBAY_BASE_URL}/commerce/translation/v1_beta/translate`, {
		method: "POST",
		headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
		body: JSON.stringify({
			from: input.from,
			to: input.to,
			text: input.texts,
			// eBay requires `translationContext` (verified live: omitting
			// it returns errorId 110003 "Context is not supported").
			// Default to ITEM_TITLE since that's the most common use
			// case for our agents (relisting US items in DE/IT/etc).
			translationContext: input.translationContext ?? "ITEM_TITLE",
		}),
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`ebay ${res.status}: ${text}`);
	}
	const body = (await res.json()) as { translations?: Array<{ translatedText: string; alternatives?: string[] }> };
	return {
		translations: (body.translations ?? []).map((t) => ({
			translatedText: t.translatedText,
			...(t.alternatives ? { translatedTextAlternatives: t.alternatives } : {}),
		})),
	};
}
