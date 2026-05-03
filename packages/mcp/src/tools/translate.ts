/**
 * Translation tool — wraps `/v1/translate` (eBay Commerce Translation
 * API). Useful for translating listing titles / descriptions / aspects
 * for cross-border listings.
 */

import { TranslateRequest } from "@flipagent/types";
import { getClient, toolErrorEnvelope } from "../client.js";
import type { Config } from "../config.js";

export { TranslateRequest as translateInput };

export const translateDescription =
	'Translate text strings between languages using eBay\'s Commerce Translation API. Calls POST /v1/translate. **When to use** — translating listing titles, descriptions, item-specific values for cross-border listings (e.g. relisting a US item on EBAY_DE in German). **Inputs** — `{ from: ISO-2 source, to: ISO-2 target, texts: string[], translationContext?: "ITEM_TITLE" | "ITEM_DESCRIPTION" | "ITEM_ASPECT_NAME" | "ITEM_ASPECT_VALUE" }`. The context biases eBay\'s translator toward the right marketplace conventions. **Output** — `{ translations: [{ translatedText, translatedTextAlternatives? }] }` — array maps 1:1 to input `texts`. **Example** — `{ from: "en", to: "de", texts: ["MacBook Air 2020 Silver"], translationContext: "ITEM_TITLE" }`.';

export async function translateExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.translate.translate(args as Parameters<typeof client.translate.translate>[0]);
	} catch (err) {
		return toolErrorEnvelope(err, "translate_failed", "/v1/translate");
	}
}
