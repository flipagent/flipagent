/**
 * `/v1/translate` — listing/title translation. Wraps commerce/translation.
 */

import { type Static, Type } from "@sinclair/typebox";
export const TranslateRequest = Type.Object(
	{
		from: Type.String({ description: "BCP-47 source language, e.g. en-US." }),
		to: Type.String({ description: "BCP-47 target language, e.g. de-DE." }),
		texts: Type.Array(Type.String(), { minItems: 1, maxItems: 50 }),
		translationContext: Type.Optional(
			Type.Union([Type.Literal("ITEM_TITLE"), Type.Literal("ITEM_DESCRIPTION"), Type.Literal("ITEM_ASPECTS")]),
		),
	},
	{ $id: "TranslateRequest" },
);
export type TranslateRequest = Static<typeof TranslateRequest>;

export const TranslateResponse = Type.Object(
	{
		translations: Type.Array(
			Type.Object({
				translatedText: Type.String(),
				translatedTextAlternatives: Type.Optional(Type.Array(Type.String())),
			}),
		),
	},
	{ $id: "TranslateResponse" },
);
export type TranslateResponse = Static<typeof TranslateResponse>;
