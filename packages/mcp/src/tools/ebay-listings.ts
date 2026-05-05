/**
 * Sell-side listing tools — backed by `/v1/listings/*` (one-shot
 * create compresses eBay's inventory_item → offer → publish flow).
 * Caller must have connected eBay via /v1/connect/ebay.
 */

import { ListingCreate, ListingUpdate } from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { getClient, toolErrorEnvelope } from "../client.js";
import type { Config } from "../config.js";
import { uiResource } from "../ui-resource.js";

export const ebayCreateInventoryItemInput = ListingCreate;

export const ebayCreateInventoryItemDescription =
	'Publish a brand-new listing on eBay (one-shot). Calls POST /v1/listings — flipagent collapses eBay\'s three-step `inventory_item → offer → publish` flow into a single call. **When to use** — after acquiring an item (forwarder receipt, photographs, condition assessment) you\'re ready to put it up for sale. **Inputs** — `title`, `description`, `price` (cents-int Money), `condition` (e.g. `new | used_excellent | used_very_good`), `categoryId` (from `flipagent_suggest_category` or `flipagent_list_categories`), `images[]` (URLs — from `flipagent_create_media_upload` or any public host), `aspects` (from `flipagent_list_category_aspects`; required ones at minimum, e.g. Brand/Model/Storage Capacity/Color for cell phones), `policies: { fulfillmentPolicyId, paymentPolicyId, returnPolicyId }` (omit and the server resolves from your existing seller policies), `merchantLocationKey` (from `flipagent_list_locations` or `flipagent_upsert_location`). For physical goods also include `package: { weight, dimensions, packageType }` — eBay rejects offers without it (LSAS error LOGISTICS_INFO_IS_MISSING). **Output** — `{ id, sku, status: "active", url }`. **Failure modes**: (1) 412 `missing_seller_policies` with `next_action.kind: setup_seller_policies` — the seller account has no return/fulfillment policy. Ask the user 5 quick questions and call `flipagent_create_seller_policies` (DO NOT invent silent defaults — earlier hidden auto-create cost sellers real money). (2) 412 `missing_listing_prereqs` — no merchant location; create one with `flipagent_upsert_location` (PE warehouse from `flipagent_get_forwarder_address` is the typical answer for international resellers). (3) 502 `publish_failed` — inventory item + offer were created but eBay rejected the publish; the response includes `upstream.errors[]` with the eBay error code. Common causes: condition not valid for category (cell phones 9355 require `used_excellent` or refurbished tiers — not `used_good`), MPN aspect required, package dimensions wrong for chosen `packageType`. **Prereqs** — eBay seller account connected, plus existing seller policies (or call `flipagent_create_seller_policies` first) + a merchant location. **Example** — `{ title: "Apple iPhone 12 mini 128GB White", description: "...", price: { value: 79900, currency: "USD" }, condition: "used_excellent", categoryId: "9355", images: ["https://…"], aspects: { Brand: ["Apple"], Model: ["iPhone 12 mini"], "Storage Capacity": ["128 GB"], Color: ["White"], MPN: ["MGDM3LL/A"] }, merchantLocationKey: "PE_TOR", brand: "Apple", mpn: "MGDM3LL/A", quantity: 1, format: "fixed_price", marketplace: "ebay", package: { weight: { value: 1, unit: "pound" }, dimensions: { length: 8, width: 6, height: 3, unit: "inch" }, packageType: "PACKAGE_THICK_ENVELOPE" } }`.';

export async function ebayCreateInventoryItemExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.listings.create(args as unknown as Parameters<typeof client.listings.create>[0]);
	} catch (err) {
		return toolErrorEnvelope(err, "listings_create_failed", "/v1/listings");
	}
}

export const ebayCreateOfferInput = Type.Composite([
	Type.Object({ sku: Type.String({ description: "SKU returned from create-listing." }) }),
	ListingUpdate,
]);

export const ebayCreateOfferDescription =
	'Patch an existing listing (price, quantity, aspects, images, description). Calls PATCH /v1/listings/{sku}. **When to use** — adjust an active listing without ending + recreating it. Common cases: drop price (markdown), restock, fix a typo, add aspects after eBay flagged a violation, add new photos. **Inputs** — `sku` (from `flipagent_create_listing`), plus any subset of mutable fields (`price`, `quantity`, `title`, `description`, `aspects`, `images`). Whatever you don\'t send is left untouched. **Output** — updated `Listing`. **Prereqs** — eBay seller account connected. On 401 the response carries `next_action` with the connect URL. **Example** — `{ sku: "ABC-001", price: { value: 5800, currency: "USD" } }` to drop price by $1.';

export async function ebayCreateOfferExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		const sku = String(args.sku);
		const { sku: _drop, ...patch } = args as Record<string, unknown>;
		return await client.listings.update(sku, patch as unknown as Parameters<typeof client.listings.update>[1]);
	} catch (err) {
		return toolErrorEnvelope(err, "listings_update_failed", "/v1/listings/{sku}");
	}
}

export const ebayPublishOfferInput = Type.Object({
	sku: Type.String(),
});

export const ebayPublishOfferDescription =
	'Re-publish a draft, ended, or unsold listing. Calls POST /v1/listings/{sku}/relist. **When to use** — recover from a publish-step failure during the original `flipagent_create_listing`, or relist an item whose previous run ended (e.g. duration expired without a sale). **Inputs** — `sku`. **Output** — updated `Listing` with `status: "active"` and a fresh `id`. **Prereqs** — eBay seller account connected. On 401 the response carries `next_action` with the connect URL. **Example** — `{ sku: "ABC-001" }`.';

export async function ebayPublishOfferExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.listings.relist(args.sku as string);
	} catch (err) {
		return toolErrorEnvelope(err, "listings_relist_failed", "/v1/listings/{sku}/relist");
	}
}

/* ----------------------------- get one ----------------------------- */

export const listingsGetInput = Type.Object({
	sku: Type.String({ description: "flipagent SKU returned from create-listing." }),
});

export const listingsGetDescription =
	'Read a single seller listing by SKU. Calls GET /v1/listings/{sku}. **When to use** — fetch the full current state of one of *your* listings (price, quantity, status, aspects, images, policies). For browsing *any* seller\'s public listing by eBay item id, use `flipagent_get_item` instead. **Inputs** — `sku`. **Output** — `Listing`. **Prereqs** — eBay seller account connected. On 404 the listing does not exist for this seller. **Example** — `{ sku: "flipagent-ABC123" }`.';

export async function listingsGetExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.listings.get(String(args.sku));
	} catch (err) {
		return toolErrorEnvelope(err, "listings_get_failed", "/v1/listings/{sku}");
	}
}

/* ----------------------------- list ----------------------------- */

export const listingsListInput = Type.Object({
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
	offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
	status: Type.Optional(
		Type.Union([
			Type.Literal("active"),
			Type.Literal("draft"),
			Type.Literal("ended"),
			Type.Literal("withdrawn"),
			Type.Literal("sold"),
		]),
	),
});

export const listingsListDescription =
	'List the connected seller\'s own listings. Calls GET /v1/listings. **When to use** — survey "what do I have for sale right now", or audit drafts left over from publish-step failures (status="draft" — no eBay item id, only inventory + offer). Pair with `flipagent_update_listing` to reprice or `flipagent_end_listing` to withdraw. **Inputs** — optional `status` (`active | draft | ended | withdrawn | sold`), pagination `limit` (1-200, default 50) + `offset`. **Output** — `{ listings: Listing[], limit, offset }`. Each `Listing` has `id` (eBay item id; null for draft), `sku` (flipagent SKU), `status`, `title`, `price` (cents-int), `categoryId`, `images`, `url` (when active). **Prereqs** — eBay seller account connected. On 401 the response carries `next_action`. **Example** — `{ status: "active" }` to see live listings only.';

export async function listingsListExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		const result = await client.listings.list(args as Parameters<typeof client.listings.list>[0]);
		const listings = (result as { listings?: unknown[] }).listings ?? [];
		const total = (result as { total?: number }).total;
		const status = typeof args.status === "string" ? args.status : undefined;
		const summary =
			listings.length === 0
				? status
					? `No ${status} listings.`
					: "No listings yet."
				: `${listings.length}${total != null && total > listings.length ? ` of ${total}` : ""} listing${listings.length === 1 ? "" : "s"}${status ? ` (${status})` : ""}. Each row has Reprice, End (when active), and Evaluate.`;
		return uiResource({
			uri: "ui://flipagent/listings",
			structuredContent: {
				listings,
				...(total != null ? { total } : {}),
				args,
			},
			summary,
		});
	} catch (err) {
		return toolErrorEnvelope(err, "listings_list_failed", "/v1/listings");
	}
}

/* ----------------------------- end ----------------------------- */

export const listingsEndInput = Type.Object({
	sku: Type.String({ description: "flipagent SKU returned from create-listing." }),
});

export const listingsEndDescription =
	'End / withdraw a listing. Calls DELETE /v1/listings/{sku}. **When to use** — pull a live listing off eBay (sold elsewhere, broken, mistake), or clean up a stuck draft from a publish-step failure. Idempotent: re-calling on an already-withdrawn listing is a no-op. **Inputs** — `sku`. **Output** — updated `Listing` with `status: "withdrawn"`. **Prereqs** — eBay seller account connected. **Example** — `{ sku: "flipagent-ABC123" }`.';

export async function listingsEndExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.listings.end(String(args.sku));
	} catch (err) {
		return toolErrorEnvelope(err, "listings_end_failed", "/v1/listings/{sku}");
	}
}

/* ----------------------------- create draft ----------------------------- */

export const listingsCreateDraftInput = Type.Object(
	{
		title: Type.String(),
		categoryId: Type.Optional(Type.String()),
		condition: Type.Optional(Type.String()),
		price: Type.Optional(Type.Object({ value: Type.Integer(), currency: Type.String() })),
		images: Type.Optional(Type.Array(Type.String())),
	},
	{ additionalProperties: true },
);

export const listingsCreateDraftDescription =
	'Create a draft listing without publishing. Calls POST /v1/listings/draft. **When to use** — partial data ready (title + category) but you want to round-trip aspects / photos / final price with the user before going live. Skips eBay\'s `publish` step entirely; the inventory_item + offer exist but no eBay item id yet (`status: draft`). Promote to live later with `flipagent_relist_listing` (or `flipagent_update_listing` + `flipagent_relist_listing` after edits). **Inputs** — same shape as `flipagent_create_listing` but every field is optional (you can save what you\'ve gathered so far and fill the rest later via `flipagent_update_listing`). **Output** — `{ sku, status: "draft" }`. **Prereqs** — eBay seller account connected. **Example** — `{ title: "Apple iPhone 12 mini", categoryId: "9355" }` to start a draft you\'ll fill in later.';

export async function listingsCreateDraftExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.listings.createDraft(args as Parameters<typeof client.listings.createDraft>[0]);
	} catch (err) {
		return toolErrorEnvelope(err, "listings_create_draft_failed", "/v1/listings/draft");
	}
}

/* ----------------------------- bulk update prices ----------------------------- */

export const listingsBulkUpdatePricesInput = Type.Object({
	updates: Type.Array(
		Type.Object({
			sku: Type.String(),
			price: Type.Optional(Type.Object({ value: Type.Integer(), currency: Type.String() })),
			quantity: Type.Optional(Type.Integer()),
		}),
		{ minItems: 1, maxItems: 25 },
	),
});

export const listingsBulkUpdatePricesDescription =
	'Update price and/or quantity on up to 25 listings in one call. Calls POST /v1/listings/bulk/price (eBay\'s `bulk_update_price_quantity` endpoint). **When to use** — markdowns across multiple SKUs, restock after intake, end-of-week repricing. For changing fields beyond price/qty (title, aspects, images), use `flipagent_update_listing` per-SKU. **Inputs** — `updates: [{ sku, price?, quantity? }, ...]` (1-25 entries). **Output** — `{ results: [{ sku, status, errors? }] }` — per-SKU success/failure so you can react to partial failures. **Prereqs** — eBay seller account connected. **Example** — `{ updates: [{ sku: "A", price: { value: 4500, currency: "USD" } }, { sku: "B", quantity: 3 }] }`.';

export async function listingsBulkUpdatePricesExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.listings.bulkUpdatePrices(args as Parameters<typeof client.listings.bulkUpdatePrices>[0]);
	} catch (err) {
		return toolErrorEnvelope(err, "listings_bulk_update_prices_failed", "/v1/listings/bulk/price");
	}
}

/* ----------------------------- bulk publish ----------------------------- */

export const listingsBulkPublishInput = Type.Object({
	skus: Type.Array(Type.String(), { minItems: 1, maxItems: 25 }),
});

export const listingsBulkPublishDescription =
	'Publish up to 25 draft listings in one call. Calls POST /v1/listings/bulk/publish (eBay\'s `bulk_publish_offer`). **When to use** — promote a batch of drafts to live in one shot (saves N×500ms HTTP per SKU vs N separate `flipagent_relist_listing` calls). **Inputs** — `skus: string[]` (1-25 SKUs from drafts created via `flipagent_create_listing` that publish-failed or `flipagent_create_draft_listing`). **Output** — `{ results: [{ sku, status, listingId?, errors? }] }`. **Prereqs** — eBay seller account connected. Each draft must already have inventory + offer (created by `flipagent_create_listing` or draft variant). **Example** — `{ skus: ["A", "B", "C"] }`.';

export async function listingsBulkPublishExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.listings.bulkPublish(args as Parameters<typeof client.listings.bulkPublish>[0]);
	} catch (err) {
		return toolErrorEnvelope(err, "listings_bulk_publish_failed", "/v1/listings/bulk/publish");
	}
}

/* Multi-variation listing-group publish / withdraw is intentionally
 * NOT exposed via MCP — the prerequisite step (creating an
 * inventory_item_group + adding member SKUs) lives behind the V2
 * /v1/listing-groups surface which isn't mounted yet. Without a way
 * for the agent to create a group end-to-end, exposing only the
 * publish/withdraw half just bloats the tool catalog with something
 * agents can't actually use. The REST surface
 * `POST /v1/listings/groups/{key}/{publish|withdraw}` plus the SDK
 * methods `client.listings.publishGroup` / `withdrawGroup` stay live
 * for power users who set up groups via the eBay seller hub UI.
 * Re-add MCP wrappers once /v1/listing-groups is promoted. */
