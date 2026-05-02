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
	const res = await fetchRetry(`${config.EBAY_BASE_URL}/commerce/translation/v1/translate`, {
		method: "POST",
		headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
		body: JSON.stringify({
			from: input.from,
			to: input.to,
			text: input.texts,
			...(input.translationContext ? { translationContext: input.translationContext } : {}),
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
