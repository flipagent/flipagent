/**
 * Bridge transport for eBay public-data reads. Queues an `ebay_data`
 * purchase order whose task `ebay_query` the Chrome extension picks up
 * via /v1/bridge/poll, fetches the eBay page (service-worker fetch +
 * DOMParser, fallback to a hidden tab when challenged), parses with
 * the shared `@flipagent/ebay-scraper`, and reports the structured
 * result back via /v1/bridge/result.
 *
 * Why bridge as a 1st-class primitive (not a fallback):
 *   - free (no Oxylabs $/req)
 *   - reads happen inside the user's existing browser session (their IP,
 *     their cookies) — same primitive that powers the human-in-the-loop
 *     buy flow, applied to read paths
 *   - up-to-date (no proxy edge cache)
 *   - some fields only render with a logged-in session
 *
 * Response shape mirrors Browse REST so callers can't tell which
 * primitive served the request — only the X-Flipagent-Source header
 * differs.
 */

import type { EbayItemDetail } from "@flipagent/ebay-scraper";
import type { BrowseSearchQuery, BrowseSearchResponse, ItemDetail, SoldSearchQuery } from "@flipagent/types/ebay";
import type { ApiKey } from "../../db/schema.js";
import { createBridgeJob, waitForTerminal } from "../bridge-jobs.js";
import { ebayDetailToBrowse } from "../ebay/scrape/normalize.js";

const TIMEOUT_MS = 30_000;

type EbayQueryMetadata =
	| { kind: "search"; query: BrowseSearchQuery }
	| { kind: "detail"; itemId: string; variationId?: string }
	| { kind: "sold"; query: SoldSearchQuery };

async function dispatch<T>(apiKey: ApiKey, metadata: EbayQueryMetadata, itemIdLabel: string): Promise<T> {
	const job = await createBridgeJob({
		apiKeyId: apiKey.id,
		userId: apiKey.userId,
		source: "ebay_data",
		itemId: itemIdLabel,
		quantity: 1,
		maxPriceCents: null,
		idempotencyKey: null,
		metadata,
	});
	const final = await waitForTerminal(job.id, apiKey.id, TIMEOUT_MS);
	if (!final) throw new BridgeError("bridge_timeout", `no terminal state after ${TIMEOUT_MS}ms`);
	if (final.status !== "completed" || !final.result) {
		throw new BridgeError("bridge_failed", `status=${final.status} reason=${final.failureReason ?? "?"}`);
	}
	return final.result as T;
}

export async function bridgeListingsSearch(apiKey: ApiKey, query: BrowseSearchQuery): Promise<BrowseSearchResponse> {
	// Extension returns BrowseSearchResponse directly — `parseEbaySearchHtml`
	// already produces ItemSummary[] in the right shape.
	return dispatch<BrowseSearchResponse>(apiKey, { kind: "search", query }, `search:${query.q ?? ""}`);
}

export async function bridgeItemDetail(
	apiKey: ApiKey,
	itemId: string,
	variationId?: string,
): Promise<ItemDetail | null> {
	// Extension returns the raw EbayItemDetail shape; we apply the same
	// transform the Oxylabs path uses so the wire output matches Browse.
	// `variationId` instructs the extension to navigate to the variation-
	// specific URL (`?var=<id>`) so the rendered price/aspects reflect the
	// requested SKU instead of eBay's default-rendered one.
	const raw = await dispatch<EbayItemDetail>(apiKey, { kind: "detail", itemId, variationId }, itemId);
	return ebayDetailToBrowse(raw, variationId);
}

export async function bridgeSoldSearch(apiKey: ApiKey, query: SoldSearchQuery): Promise<BrowseSearchResponse> {
	return dispatch<BrowseSearchResponse>(apiKey, { kind: "sold", query }, `sold:${query.q ?? ""}`);
}

export class BridgeError extends Error {
	constructor(
		readonly code: "bridge_timeout" | "bridge_failed" | "bridge_not_paired",
		message: string,
	) {
		super(message);
		this.name = "BridgeError";
	}
}
