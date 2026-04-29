/**
 * LLM provider abstraction for the comp matcher. The matcher only needs
 * one operation: send a text + image multimodal message and get text
 * back. Each provider adapter normalises its SDK to that shape.
 *
 * Selection is env-driven:
 *
 *   LLM_PROVIDER=anthropic|openai|google   explicit pick (wins).
 *   otherwise                              first key set, in order:
 *                                          anthropic → openai → google.
 *
 * Models are configurable per provider (`ANTHROPIC_MODEL`, `OPENAI_MODEL`,
 * `GOOGLE_MODEL`) with vision-capable defaults.
 */

import { config } from "../../../config.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createGoogleProvider } from "./google.js";
import { createOpenAiProvider } from "./openai.js";

export type LlmProviderName = "anthropic" | "openai" | "google";

export interface LlmContent {
	type: "text" | "image";
	text?: string;
	imageUrl?: string;
}

export interface LlmRequest {
	system: string;
	user: LlmContent[];
	maxTokens: number;
}

export interface LlmProvider {
	name: LlmProviderName;
	model: string;
	/** Returns the model's raw text response. Caller parses JSON. */
	complete(req: LlmRequest): Promise<string>;
}

/**
 * Resolve which provider to use. Throws if none configured — caller
 * surfaces 503 to the client.
 */
export function pickProvider(): LlmProvider {
	const explicit = config.LLM_PROVIDER;
	if (explicit === "anthropic") return createAnthropicProvider();
	if (explicit === "openai") return createOpenAiProvider();
	if (explicit === "google") return createGoogleProvider();

	if (config.ANTHROPIC_API_KEY) return createAnthropicProvider();
	if (config.OPENAI_API_KEY) return createOpenAiProvider();
	if (config.GOOGLE_API_KEY) return createGoogleProvider();

	throw new Error("No LLM provider configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY.");
}

/** True when at least one LLM provider key is set. Used by /v1/health/features. */
export function isAnyLlmConfigured(): boolean {
	return Boolean(config.ANTHROPIC_API_KEY || config.OPENAI_API_KEY || config.GOOGLE_API_KEY);
}
