import { describe, expect, it } from "vitest";
import { ApiCallError, toApiCallError } from "../src/client.js";

describe("toApiCallError", () => {
	it("passes ApiCallError through unchanged", () => {
		const original = new ApiCallError("boom", { status: 500, url: "/x" });
		expect(toApiCallError(original)).toBe(original);
	});

	it("prefers the api's `message` body over the SDK's status-string fallback", () => {
		// Shape from the new @flipagent/sdk; we duck-type so the test
		// doesn't depend on the SDK build artifact at vitest runtime.
		const err = {
			message: "flipagent /v1/items/search failed with status 401",
			status: 401,
			path: "/v1/items/search",
			detail: { error: "ebay_account_not_connected", message: "Connect an eBay seller account first." },
		};
		const e = toApiCallError(err);
		expect(e.status).toBe(401);
		expect(e.url).toBe("/v1/items/search");
		expect(e.message).toBe("Connect an eBay seller account first.");
	});

	it("falls back to the api's `error` code when no `message` body is present", () => {
		const err = {
			message: "flipagent /v1/items/search failed with status 401",
			status: 401,
			path: "/v1/items/search",
			detail: { error: "unauthenticated" },
		};
		const e = toApiCallError(err);
		expect(e.message).toBe("unauthenticated");
	});

	it("surfaces next_action when present in the api response body", () => {
		const err = {
			status: 401,
			path: "/v1/listings",
			detail: {
				error: "ebay_account_not_connected",
				message: "Connect an eBay seller account first.",
				next_action: {
					kind: "ebay_oauth",
					url: "https://api.flipagent.dev/v1/connect/ebay",
					instructions: "Send the user to this URL to authorize.",
				},
			},
		};
		const e = toApiCallError(err);
		expect(e.nextAction?.kind).toBe("ebay_oauth");
		expect(e.nextAction?.url).toBe("https://api.flipagent.dev/v1/connect/ebay");
		expect(e.nextAction?.instructions).toBe("Send the user to this URL to authorize.");
	});

	it("uses fallbackPath when no url is on the error", () => {
		const err = { message: "boom", status: 502 };
		const e = toApiCallError(err, "/v1/items/search");
		expect(e.url).toBe("/v1/items/search");
		expect(e.status).toBe(502);
	});

	it("yields default 'request failed' when error has no message", () => {
		const e = toApiCallError({});
		expect(e.message).toBe("request failed");
		expect(e.status).toBeUndefined();
	});

	it("survives undefined error gracefully", () => {
		const e = toApiCallError(undefined, "/v1/evaluate");
		expect(e.message).toBe("request failed");
		expect(e.url).toBe("/v1/evaluate");
	});
});
