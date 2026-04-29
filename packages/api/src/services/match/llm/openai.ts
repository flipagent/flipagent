/**
 * OpenAI adapter. Uses chat.completions with `image_url` content parts
 * for vision — OpenAI accepts public HTTPS URLs directly. We don't pin
 * `response_format: json_object` because triage returns a top-level
 * array (json_object mode rejects that). The matcher's parser strips
 * fences / preamble defensively across all providers.
 */

import OpenAI from "openai";
import { config } from "../../../config.js";
import type { LlmContent, LlmProvider, LlmRequest } from "./index.js";

const DEFAULT_MODEL = "gpt-5.4-mini";

export function createOpenAiProvider(): LlmProvider {
	const apiKey = config.OPENAI_API_KEY;
	if (!apiKey) throw new Error("OPENAI_API_KEY not set");
	const client = new OpenAI({ apiKey });
	const model = config.OPENAI_MODEL ?? DEFAULT_MODEL;

	return {
		name: "openai",
		model,
		async complete({ system, user, maxTokens }: LlmRequest): Promise<string> {
			const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = user.map(toPart);
			const res = await client.chat.completions.create({
				model,
				max_completion_tokens: maxTokens,
				messages: [
					{ role: "system", content: system },
					{ role: "user", content: parts },
				],
			});
			return res.choices[0]?.message?.content ?? "";
		},
	};
}

function toPart(c: LlmContent): OpenAI.Chat.Completions.ChatCompletionContentPart {
	if (c.type === "image" && c.imageUrl) {
		return { type: "image_url", image_url: { url: c.imageUrl } };
	}
	return { type: "text", text: c.text ?? "" };
}
