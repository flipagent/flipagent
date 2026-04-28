import { describe, expect, it } from "vitest";
import { ApiCallError, toApiCallError } from "../src/client.js";

describe("toApiCallError", () => {
	it("passes ApiCallError through unchanged", () => {
		const original = new ApiCallError("boom", { status: 500, url: "/x" });
		expect(toApiCallError(original)).toBe(original);
	});

	it("extracts status + path from a FlipagentApiError-shaped error", () => {
		// Shape from the new @flipagent/sdk; we duck-type so the test
		// doesn't depend on the SDK build artifact at vitest runtime.
		const err = {
			message: "flipagent /v1/listings/search failed with status 401",
			status: 401,
			path: "/v1/listings/search",
			detail: { error: "unauthenticated" },
		};
		const e = toApiCallError(err);
		expect(e.status).toBe(401);
		expect(e.url).toBe("/v1/listings/search");
		expect(e.message).toContain("401");
	});

	it("uses fallbackPath when no url is on the error", () => {
		const err = { message: "boom", status: 502 };
		const e = toApiCallError(err, "/v1/listings/search");
		expect(e.url).toBe("/v1/listings/search");
		expect(e.status).toBe(502);
	});

	it("yields default 'request failed' when error has no message", () => {
		const e = toApiCallError({});
		expect(e.message).toBe("request failed");
		expect(e.status).toBeUndefined();
	});

	it("survives undefined error gracefully", () => {
		const e = toApiCallError(undefined, "/v1/deals/find");
		expect(e.message).toBe("request failed");
		expect(e.url).toBe("/v1/deals/find");
	});
});
