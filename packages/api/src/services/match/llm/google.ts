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

export function createGoogleProvider(): LlmProvider {
	const apiKey = config.GOOGLE_API_KEY;
	if (!apiKey) throw new Error("GOOGLE_API_KEY not set");
	const ai = new GoogleGenAI({ apiKey });
	const model = config.GOOGLE_MODEL ?? DEFAULT_MODEL;

	return {
		name: "google",
		model,
		async complete({ system, user, maxTokens }: LlmRequest): Promise<string> {
			const parts = await Promise.all(user.map(toPart));
			const res = await ai.models.generateContent({
				model,
				contents: [{ role: "user", parts }],
				config: {
					systemInstruction: system,
					maxOutputTokens: maxTokens,
					// Disable extended thinking — for our matching task, hidden
					// reasoning eats output budget and silently truncates the
					// JSON array. The verify call wants a structured decision,
					// not chain-of-thought.
					thinkingConfig: { thinkingBudget: 0 },
				},
			});
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
