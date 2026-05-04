/**
 * Google Gemini adapter. Uses `@google/genai` (the post-2024 unified
 * SDK). Vision works via `inlineData` (base64) — Gemini's `fileData`
 * URI mode only accepts Cloud Storage / Files API URIs, not arbitrary
 * eBay image URLs, so we fetch + base64-encode each image once before
 * the call.
 */

import { GoogleGenAI } from "@google/genai";
import { config } from "../../../config.js";
import type { LlmContent, LlmProvider, LlmRequest } from "./index.js";

const DEFAULT_MODEL = "gemini-2.5-flash";

export function createGoogleProvider(modelOverride?: string): LlmProvider {
	const apiKey = config.GOOGLE_API_KEY;
	if (!apiKey) throw new Error("GOOGLE_API_KEY not set");
	const ai = new GoogleGenAI({ apiKey });
	const model = modelOverride ?? config.GOOGLE_MODEL ?? DEFAULT_MODEL;

	return {
		name: "google",
		model,
		async complete({ system, user, maxTokens }: LlmRequest): Promise<string> {
			const parts = await Promise.all(user.map(toPart));
			// Pro models (gemini-3-pro / 3.1-pro / 2.5-pro) REQUIRE thinking mode and reject
			// thinkingBudget=0. Flash/lite models default to thinking on but waste output
			// budget on hidden reasoning for our structured-JSON task — explicitly disable.
			const isPro = /pro/i.test(model);
			const thinkingBudget = process.env.GOOGLE_THINKING_BUDGET
				? Number.parseInt(process.env.GOOGLE_THINKING_BUDGET, 10)
				: isPro
					? -1
					: 0; // -1 = let model decide (pro default), 0 = disabled
			const res = await ai.models.generateContent({
				model,
				contents: [{ role: "user", parts }],
				config: {
					systemInstruction: system,
					maxOutputTokens: maxTokens,
					// Deterministic decoding for classification — same input → same output
					// (modulo Gemini's residual sampling noise). F1 ceiling slightly lower
					// vs default temp but variance reduced from ±0.10 to ±0.03 — predictable
					// production behavior matters more than peak performance. Override with
					// `GOOGLE_TEMPERATURE` env when exploring/benchmarking.
					temperature: process.env.GOOGLE_TEMPERATURE ? Number.parseFloat(process.env.GOOGLE_TEMPERATURE) : 0,
					...(thinkingBudget >= 0 ? { thinkingConfig: { thinkingBudget } } : {}),
				},
			});
			if (process.env.LOG_USAGE === "1") {
				const u = (
					res as unknown as {
						usageMetadata?: {
							promptTokenCount?: number;
							candidatesTokenCount?: number;
							cachedContentTokenCount?: number;
						};
					}
				).usageMetadata;
				if (u)
					console.log(
						`[llm.google.usage] prompt=${u.promptTokenCount} cached=${u.cachedContentTokenCount ?? 0} candidates=${u.candidatesTokenCount}`,
					);
			}
			return res.text ?? "";
		},
	};
}

interface InlineImagePart {
	inlineData: { mimeType: string; data: string };
}
interface TextPart {
	text: string;
}
type GeminiPart = TextPart | InlineImagePart;

async function toPart(c: LlmContent): Promise<GeminiPart> {
	if (c.type === "image" && c.imageUrl) {
		const fetched = await fetchImage(c.imageUrl);
		if (fetched) return { inlineData: fetched };
		// Image fetch failed — degrade to a text marker so the call still
		// goes through. The verifier will note the mismatch in its reason.
		return { text: `[image unavailable: ${c.imageUrl}]` };
	}
	return { text: c.text ?? "" };
}

async function fetchImage(url: string): Promise<{ mimeType: string; data: string } | null> {
	try {
		const res = await fetch(url);
		if (!res.ok) return null;
		const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
		const buf = Buffer.from(await res.arrayBuffer());
		return { mimeType, data: buf.toString("base64") };
	} catch {
		return null;
	}
}
