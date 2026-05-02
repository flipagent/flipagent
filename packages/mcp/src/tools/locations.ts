/**
 * Merchant-location tools — `/v1/locations/*`. `id` is the eBay-side
 * `merchantLocationKey` and is required by `flipagent_listings_create`.
 * Agents should call `flipagent_locations_list` first to find an
 * existing location, or `flipagent_locations_upsert` to create one.
 */

import { LocationCreate } from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

/* ------------------------- flipagent_locations_list ------------------------ */

export const locationsListInput = Type.Object({});

export const locationsListDescription =
	"List the connected seller's fulfillment locations. GET /v1/locations. Each row has `id` (= eBay `merchantLocationKey`), `address`, `status`. Pick one for `flipagent_listings_create.merchantLocationKey`.";

export async function locationsListExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.locations.list();
	} catch (err) {
		const e = toApiCallError(err, "/v1/locations");
		return { error: "locations_list_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* -------------------------- flipagent_locations_get ------------------------ */

export const locationsGetInput = Type.Object({ id: Type.String({ minLength: 1 }) });

export const locationsGetDescription = "Fetch one location by id. GET /v1/locations/{id}.";

export async function locationsGetExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const id = String(args.id);
	try {
		const client = getClient(config);
		return await client.locations.get(id);
	} catch (err) {
		const e = toApiCallError(err, `/v1/locations/${id}`);
		return { error: "locations_get_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* ------------------------ flipagent_locations_upsert ----------------------- */

export const locationsUpsertInput = Type.Composite([
	Type.Object({ id: Type.String({ minLength: 1, description: "Stable key — used as eBay merchantLocationKey." }) }),
	LocationCreate,
]);

export const locationsUpsertDescription =
	"Create or replace a fulfillment location. PUT /v1/locations/{id}. Idempotent on `id`. Use this once before listing — `flipagent_listings_create.merchantLocationKey` must reference an existing location id.";

export async function locationsUpsertExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const { id, ...body } = args as { id: string } & Record<string, unknown>;
	try {
		const client = getClient(config);
		return await client.locations.upsert(id, body as Parameters<typeof client.locations.upsert>[1]);
	} catch (err) {
		const e = toApiCallError(err, `/v1/locations/${id}`);
		return { error: "locations_upsert_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* ------------------------ flipagent_locations_delete ----------------------- */

export const locationsDeleteInput = Type.Object({ id: Type.String({ minLength: 1 }) });

export const locationsDeleteDescription =
	"Delete a fulfillment location. DELETE /v1/locations/{id}. Fails if any active listing still references it.";

export async function locationsDeleteExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const id = String(args.id);
	try {
		const client = getClient(config);
		return await client.locations.delete(id);
	} catch (err) {
		const e = toApiCallError(err, `/v1/locations/${id}`);
		return { error: "locations_delete_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* ------------------------ flipagent_locations_enable ----------------------- */

export const locationsEnableInput = Type.Object({ id: Type.String({ minLength: 1 }) });

export const locationsEnableDescription =
	"Enable a previously-disabled location. POST /v1/locations/{id}/enable. Disabled locations can't be referenced by new listings.";

export async function locationsEnableExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const id = String(args.id);
	try {
		const client = getClient(config);
		return await client.locations.enable(id);
	} catch (err) {
		const e = toApiCallError(err, `/v1/locations/${id}/enable`);
		return { error: "locations_enable_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* ----------------------- flipagent_locations_disable ----------------------- */

export const locationsDisableInput = Type.Object({ id: Type.String({ minLength: 1 }) });

export const locationsDisableDescription =
	"Disable a location without deleting it. POST /v1/locations/{id}/disable. Existing listings stay live; new listings can't reference it.";

export async function locationsDisableExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const id = String(args.id);
	try {
		const client = getClient(config);
		return await client.locations.disable(id);
	} catch (err) {
		const e = toApiCallError(err, `/v1/locations/${id}/disable`);
		return { error: "locations_disable_failed", status: e.status, url: e.url, message: e.message };
	}
}
