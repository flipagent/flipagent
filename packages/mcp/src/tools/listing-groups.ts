/**
 * Listing-group tools — variation parents (clothing sizes, etc.).
 * eBay's "inventoryItemGroup" concept normalized.
 */

import { ListingGroupUpsert } from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

/* ----------------------- flipagent_listing_groups_get ---------------------- */

export const listingGroupsGetInput = Type.Object({ id: Type.String({ minLength: 1 }) });
export const listingGroupsGetDescription = "Fetch one listing group + its child SKUs. GET /v1/listing-groups/{id}.";
export async function listingGroupsGetExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const id = String(args.id);
	try {
		const client = getClient(config);
		return await client.listingGroups.get(id);
	} catch (err) {
		const e = toApiCallError(err, `/v1/listing-groups/${id}`);
		return { error: "listing_groups_get_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* --------------------- flipagent_listing_groups_upsert --------------------- */

export const listingGroupsUpsertInput = Type.Composite([
	Type.Object({ id: Type.String({ minLength: 1 }) }),
	ListingGroupUpsert,
]);
export const listingGroupsUpsertDescription =
	"Create or replace a listing group. PUT /v1/listing-groups/{id}. Use to publish variation listings (size / colour matrices) — child SKUs come from `flipagent_listings_create` first.";
export async function listingGroupsUpsertExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const { id, ...body } = args as { id: string } & Record<string, unknown>;
	try {
		const client = getClient(config);
		return await client.listingGroups.upsert(id, body as Parameters<typeof client.listingGroups.upsert>[1]);
	} catch (err) {
		const e = toApiCallError(err, `/v1/listing-groups/${id}`);
		return { error: "listing_groups_upsert_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* --------------------- flipagent_listing_groups_delete --------------------- */

export const listingGroupsDeleteInput = Type.Object({ id: Type.String({ minLength: 1 }) });
export const listingGroupsDeleteDescription = "Delete a listing group. DELETE /v1/listing-groups/{id}.";
export async function listingGroupsDeleteExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const id = String(args.id);
	try {
		const client = getClient(config);
		return await client.listingGroups.delete(id);
	} catch (err) {
		const e = toApiCallError(err, `/v1/listing-groups/${id}`);
		return { error: "listing_groups_delete_failed", status: e.status, url: e.url, message: e.message };
	}
}
