/**
 * Oxylabs adapter quirk: wrapper returns 200 OK and tucks upstream
 * status into `results[0].status_code`. fetchRetry can't see those, so
 * the adapter classifies them itself and retries transient ones. The
 * regression we're guarding: prior to this, one 613 ("faulty job") on
 * any sold-search call would silently drop a whole cluster from a
 * multi-cluster discover.
 */

import { describe, expect, it } from "vitest";
import { parseRetryableCode } from "../../../src/services/ebay/scrape/scraper-api/oxylabs.js";

describe("parseRetryableCode", () => {
	it("returns the code for transient upstream classes", () => {
		expect(parseRetryableCode(new Error("oxylabs_upstream_613"))).toBe(613);
		expect(parseRetryableCode(new Error("oxylabs_upstream_429"))).toBe(429);
		expect(parseRetryableCode(new Error("oxylabs_upstream_502"))).toBe(502);
		expect(parseRetryableCode(new Error("oxylabs_http_503"))).toBe(503);
		expect(parseRetryableCode(new Error("oxylabs_upstream_520"))).toBe(520);
	});

	it("returns null for non-retryable upstream codes", () => {
		// 4xx that are NOT 408/425/429 are caller-bug; retry won't help.
		expect(parseRetryableCode(new Error("oxylabs_upstream_404"))).toBeNull();
		expect(parseRetryableCode(new Error("oxylabs_upstream_410"))).toBeNull();
		expect(parseRetryableCode(new Error("oxylabs_upstream_400"))).toBeNull();
	});

	it("returns null for non-oxylabs errors", () => {
		expect(parseRetryableCode(new Error("scraper_api_not_configured"))).toBeNull();
		expect(parseRetryableCode(new Error("oxylabs_no_results"))).toBeNull();
		expect(parseRetryableCode(new Error("oxylabs_empty_content"))).toBeNull();
		expect(parseRetryableCode("plain string")).toBeNull();
		expect(parseRetryableCode(null)).toBeNull();
	});
});
