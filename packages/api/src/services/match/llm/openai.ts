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

export function createOpenAiProvider(modelOverride?: string): LlmProvider {
	const apiKey = config.OPENAI_API_KEY;
	if (!apiKey) throw new Error("OPENAI_API_KEY not set");
	const client = new OpenAI({ apiKey });
	const model = modelOverride ?? config.OPENAI_MODEL ?? DEFAULT_MODEL;

	return {
		name: "openai",
		model,
		async complete({ system, user, maxTokens }: LlmRequest): Promise<string> {
			const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = user.map(toPart);
			const res = await client.chat.completions.create({
				model,
				max_completion_tokens: maxTokens,
				// gpt-5.x reasoning models accept reasoning_effort: "minimal"/"low"/"medium"/"high".
				// Classification tasks like ours benefit from light reasoning (model thinks
				// through canonicalization) without the latency hit of "high".
				...(process.env.OPENAI_REASONING_EFFORT
					? { reasoning_effort: process.env.OPENAI_REASONING_EFFORT as "minimal" | "low" | "medium" | "high" }
					: {}),
				messages: [
					{ role: "system", content: system },
					{ role: "user", content: parts },
				],
			});
			if (process.env.LOG_USAGE === "1") {
				const u = (
					res as unknown as {
						usage?: {
							prompt_tokens?: number;
							completion_tokens?: number;
							prompt_tokens_details?: { cached_tokens?: number };
						};
					}
				).usage;
				if (u)
					console.log(
						`[llm.openai.usage] prompt=${u.prompt_tokens} cached=${u.prompt_tokens_details?.cached_tokens ?? 0} completion=${u.completion_tokens}`,
					);
			}
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
