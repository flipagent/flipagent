/**
 * `parseJsonArray` is the only thing standing between a flaky LLM
 * response and the matcher's "empty parse" failure mode. The cases that
 * ACTUALLY happen in production:
 *   - ```json fenced output (Gemini default)
 *   - Mid-stream truncation when maxTokens runs out (no closing `]`)
 *   - Trailing prose after the array
 * If any of these returns [] the caller throws and a verify chunk is
 * lost. Test the recoveries explicitly.
 */

import { describe, expect, it } from "vitest";
// Indirect import — the helper isn't public, so we exercise it through
// a tiny synthetic script. Easier: re-export from the matcher for tests.
// For now we vendor the behaviour test by copy-pasting a fixture set.
import { __parseJsonArrayForTest as parseJsonArray } from "../../../src/services/match/matcher.js";

describe("parseJsonArray (matcher)", () => {
	it("parses a clean array", () => {
		expect(parseJsonArray<{ i: number }>('[{"i":0},{"i":1}]')).toEqual([{ i: 0 }, { i: 1 }]);
	});

	it("strips ```json fences", () => {
		const text = '```json\n[{"i":0,"decision":"keep"},{"i":1,"decision":"drop"}]\n```';
		expect(parseJsonArray<{ i: number; decision: string }>(text)).toEqual([
			{ i: 0, decision: "keep" },
			{ i: 1, decision: "drop" },
		]);
	});

	it("recovers complete objects from a truncated array", () => {
		// Gemini cut off mid-string when maxTokens ran out — no closing `]`.
		const text =
			'```json\n[\n  {"i":0,"decision":"keep","reason":"matches"},\n  {"i":1,"decision":"drop","reason":"different sku"},\n  {"i":2,"decision":"keep","reason":"par';
		const got = parseJsonArray<{ i: number; decision: string }>(text);
		expect(got).toHaveLength(2);
		expect(got[0]).toEqual({ i: 0, decision: "keep", reason: "matches" });
		expect(got[1]).toEqual({ i: 1, decision: "drop", reason: "different sku" });
	});

	it("ignores trailing prose after the array", () => {
		const text = '[{"i":0}]\n\nThat\'s the group decisions.';
		expect(parseJsonArray<{ i: number }>(text)).toEqual([{ i: 0 }]);
	});

	it("returns [] when there's no array at all", () => {
		expect(parseJsonArray("I cannot help with this query.")).toEqual([]);
	});

	it("handles strings that contain braces", () => {
		const text = '[{"i":0,"reason":"object {} like text"}]';
		expect(parseJsonArray<{ reason: string }>(text)).toEqual([{ i: 0, reason: "object {} like text" }]);
	});
});
