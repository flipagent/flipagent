/**
 * `POST /v1/listings` orchestrator. Compresses eBay's three-step flow:
 *
 *   1. PUT  /sell/inventory/v1/inventory_item/{sku}     create stock unit
 *   2. POST /sell/inventory/v1/offer                    bridge to listing
 *   3. POST /sell/inventory/v1/offer/{offerId}/publish  go live
 *
 * Caller passes a flipagent `ListingCreate`; we return the live
 * `Listing`. Partial-failure semantics:
 *   - Step 1 fail → no side effects (PUT is idempotent on SKU).
 *   - Step 2 fail after step 1 → inventory_item lingers; same call
 *     re-runs cleanly on retry (PUT replaces, POST returns existing).
 *   - Step 3 fail after step 2 → offer lingers in `UNPUBLISHED`; the
 *     returned `Listing` carries the offerId so the caller can retry
 *     `POST /v1/listings/{sku}/relist` without resubmitting fields.
 */

import type { Listing, ListingCreate, ListingPolicies } from "@flipagent/types";
import type { OfferDetails } from "@flipagent/types/ebay/sell";
import { sellRequest } from "../ebay/rest/user-client.js";
import { DefaultsLookupError, resolveListingDefaults } from "./defaults.js";
import { ebayToListing, listingCreateToEbay } from "./transform.js";

const NANOID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function generateSku(): string {
	let s = "flipagent-";
	for (let i = 0; i < 12; i++) {
		s += NANOID_ALPHABET[Math.floor(Math.random() * NANOID_ALPHABET.length)];
	}
	return s;
}

export interface CreateListingContext {
	apiKeyId: string;
}

export interface CreateListingResult {
	listing: Listing;
	/** True when step 3 succeeded — the listing went live. False when only steps 1+2 ran. */
	published: boolean;
}

export async function createListing(input: ListingCreate, ctx: CreateListingContext): Promise<CreateListingResult> {
	const sku = input.sku ?? generateSku();

	// Resolve missing prereqs via auto-discovery (cached 24h).
	let policies: Required<ListingPolicies>;
	let merchantLocationKey: string;
	const fullyProvided =
		input.policies?.fulfillmentPolicyId &&
		input.policies?.paymentPolicyId &&
		input.policies?.returnPolicyId &&
		input.merchantLocationKey;

	if (fullyProvided) {
		policies = input.policies as Required<ListingPolicies>;
		merchantLocationKey = input.merchantLocationKey as string;
	} else {
		try {
			const resolved = await resolveListingDefaults(ctx.apiKeyId);
			policies = {
				fulfillmentPolicyId: input.policies?.fulfillmentPolicyId ?? resolved.policies.fulfillmentPolicyId,
				paymentPolicyId: input.policies?.paymentPolicyId ?? resolved.policies.paymentPolicyId,
				returnPolicyId: input.policies?.returnPolicyId ?? resolved.policies.returnPolicyId,
			};
			merchantLocationKey = input.merchantLocationKey ?? resolved.merchantLocationKey;
		} catch (err) {
			if (err instanceof DefaultsLookupError) {
				throw new MissingPrereqError(err.code, err.message);
			}
			throw err;
		}
	}

	const { inventoryItem, offerDetails } = listingCreateToEbay(input, {
		sku,
		policies,
		merchantLocationKey,
	});

	// Step 1 — PUT inventory_item (idempotent).
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "PUT",
		path: `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
		body: inventoryItem,
		marketplace: offerDetails.marketplaceId,
		contentLanguage: "en-US",
	});

	// Step 2 — POST offer.
	const offerRes = await sellRequest<{ offerId: string }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/sell/inventory/v1/offer",
		body: offerDetails,
		marketplace: offerDetails.marketplaceId,
		contentLanguage: "en-US",
	});
	const offerId = offerRes?.offerId;
	if (!offerId) {
		throw new Error("eBay createOffer succeeded but returned no offerId");
	}

	// Step 3 — publish.
	let listingId: string | undefined;
	let published = false;
	try {
		const publishRes = await sellRequest<{ listingId: string }>({
			apiKeyId: ctx.apiKeyId,
			method: "POST",
			path: `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`,
			body: {},
			marketplace: offerDetails.marketplaceId,
		});
		listingId = publishRes?.listingId;
		published = !!listingId;
	} catch (err) {
		// Surface the listing in `draft` state with the offerId so the
		// caller can retry `/relist` without re-sending the body.
		const listing = ebayToListing({
			sku,
			inventoryItem,
			offer: { offerId, ...offerDetails } satisfies Partial<OfferDetails> & { offerId: string },
			marketplace: input.marketplace,
		});
		throw new PublishFailedError(listing, err);
	}

	const listing = ebayToListing({
		sku,
		inventoryItem,
		offer: {
			offerId,
			listing: listingId ? { listingId } : undefined,
			...offerDetails,
		} satisfies Partial<OfferDetails> & {
			offerId: string;
			listing?: { listingId?: string };
		},
		marketplace: input.marketplace,
	});

	return { listing, published };
}

export class MissingPrereqError extends Error {
	readonly code: string;
	readonly status = 412;
	constructor(code: string, message: string) {
		super(message);
		this.name = "MissingPrereqError";
		this.code = code;
	}
}

export class PublishFailedError extends Error {
	readonly partial: Listing;
	readonly upstreamCause: unknown;
	readonly status = 502;
	constructor(partial: Listing, upstreamCause: unknown) {
		super("publish_failed: inventory item + offer created but publish step failed");
		this.name = "PublishFailedError";
		this.partial = partial;
		this.upstreamCause = upstreamCause;
	}
}
