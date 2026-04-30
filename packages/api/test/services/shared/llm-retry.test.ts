/**
 * Transient-error classifier for the LLM provider retry wrapper.
 * The three vendor SDKs (Anthropic / OpenAI / Google) emit overlapping
 * but non-identical error shapes — this guards that we recognise the
 * common transient cases across all of them.
 */

import { describe, expect, it } from "vitest";
import { isTransientLlmError } from "../../../src/services/match/llm/index.js";

describe("isTransientLlmError", () => {
	it("flags 5xx and rate-limit status codes", () => {
		expect(isTransientLlmError({ status: 500 })).toBe(true);
		expect(isTransientLlmError({ status: 502 })).toBe(true);
		expect(isTransientLlmError({ status: 503 })).toBe(true);
		expect(isTransientLlmError({ status: 529 })).toBe(true);
		expect(isTransientLlmError({ status: 429 })).toBe(true);
		expect(isTransientLlmError({ status: 408 })).toBe(true);
		// `statusCode` (Google SDK) too.
		expect(isTransientLlmError({ statusCode: 503 })).toBe(true);
	});

	it("doesn't flag non-transient client errors", () => {
		expect(isTransientLlmError({ status: 400 })).toBe(false);
		expect(isTransientLlmError({ status: 401 })).toBe(false);
		expect(isTransientLlmError({ status: 404 })).toBe(false);
		expect(isTransientLlmError({ status: 422 })).toBe(false);
	});

	it("flags Anthropic-style overloaded errors by name", () => {
		const err = Object.assign(new Error("Anthropic API overloaded"), { name: "OverloadedError" });
		expect(isTransientLlmError(err)).toBe(true);
	});

	it("flags rate-limit messages without explicit status", () => {
		expect(isTransientLlmError(new Error("rate limit exceeded, please retry"))).toBe(true);
		expect(isTransientLlmError(new Error("model is temporarily unavailable"))).toBe(true);
		expect(isTransientLlmError(new Error("request timed out"))).toBe(true);
	});

	it("flags transport-level Node errors", () => {
		expect(isTransientLlmError({ code: "ECONNRESET" })).toBe(true);
		expect(isTransientLlmError({ code: "ETIMEDOUT" })).toBe(true);
		expect(isTransientLlmError({ code: "UND_ERR_SOCKET" })).toBe(true);
	});

	it("doesn't flag arbitrary non-transient errors", () => {
		expect(isTransientLlmError(new Error("invalid JSON in response"))).toBe(false);
		expect(isTransientLlmError(new Error("model returned empty content"))).toBe(false);
		expect(isTransientLlmError("plain string")).toBe(false);
		expect(isTransientLlmError(null)).toBe(false);
	});
});
