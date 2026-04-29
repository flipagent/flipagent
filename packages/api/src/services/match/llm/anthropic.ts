/**
 * Anthropic Claude adapter. Uses Messages API with image_url blocks
 * for vision; Anthropic accepts public HTTPS URLs directly so no
 * pre-fetch needed.
 */

import Anthropic from "@anthropic-ai/sdk";
import { config } from "../../../config.js";
import type { LlmContent, LlmProvider, LlmRequest } from "./index.js";

const DEFAULT_MODEL = "claude-haiku-4-5";

export function createAnthropicProvider(): LlmProvider {
	const apiKey = config.ANTHROPIC_API_KEY;
	if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
	const client = new Anthropic({ apiKey });
	const model = config.ANTHROPIC_MODEL ?? DEFAULT_MODEL;

	return {
		name: "anthropic",
		model,
		async complete({ system, user, maxTokens }: LlmRequest): Promise<string> {
			const blocks: Anthropic.ContentBlockParam[] = user.map(toBlock);
			const res = await client.messages.create({
				model,
				max_tokens: maxTokens,
				system,
				messages: [{ role: "user", content: blocks }],
			});
			return res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
		},
	};
}

function toBlock(c: LlmContent): Anthropic.ContentBlockParam {
	if (c.type === "image" && c.imageUrl) {
		return { type: "image", source: { type: "url", url: c.imageUrl } };
	}
	return { type: "text", text: c.text ?? "" };
}
