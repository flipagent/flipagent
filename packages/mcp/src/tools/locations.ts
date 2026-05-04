/**
 * Merchant-location tools — `/v1/locations/*`. `id` is the eBay-side
 * `merchantLocationKey` and is required by `flipagent_listings_create`.
 * Agents should call `flipagent_locations_list` first to find an
 * existing location, or `flipagent_locations_upsert` to create one.
 */

import { LocationCreate } from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { getClient, toolErrorEnvelope } from "../client.js";
import type { Config } from "../config.js";

/* ------------------------- flipagent_locations_list ------------------------ */

export const locationsListInput = Type.Object({});

export const locationsListDescription =
	'List the connected seller\'s fulfillment locations (warehouses, home addresses, forwarder hubs). Calls GET /v1/locations. **When to use** — required step before `flipagent_create_listing`: every listing needs `merchantLocationKey` pointing at one of these. **Inputs** — none. **Output** — `{ locations: [{ id, address, status: "enabled" | "disabled", types }] }`. The `id` is eBay\'s `merchantLocationKey`. **Prereqs** — eBay seller account connected. If empty, create one via `flipagent_upsert_location`. On 401 the response carries `next_action`. **Example** — call with `{}`, pick the first enabled `id`.';

export async function locationsListExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.locations.list();
	} catch (err) {
		return toolErrorEnvelope(err, "locations_list_failed", "/v1/locations");
	}
}

/* -------------------------- flipagent_locations_get ------------------------ */

export const locationsGetInput = Type.Object({ id: Type.String({ minLength: 1 }) });

export const locationsGetDescription =
	'Fetch one fulfillment location by id. Calls GET /v1/locations/{id}. **When to use** — read a single location\'s full address + status (rare; usually `flipagent_list_locations` is enough). **Inputs** — `id`. **Output** — full Location object: `{ id, address, status, types, geoCoordinates? }`. **Prereqs** — eBay seller account connected. **Example** — `{ id: "WAREHOUSE_NY" }`.';

export async function locationsGetExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const id = String(args.id);
	try {
		const client = getClient(config);
		return await client.locations.get(id);
	} catch (err) {
		return toolErrorEnvelope(err, "locations_get_failed", `/v1/locations/${id}`);
	}
}

/* ------------------------ flipagent_locations_upsert ----------------------- */

export const locationsUpsertInput = Type.Composite([
	Type.Object({ id: Type.String({ minLength: 1, description: "Stable key — used as eBay merchantLocationKey." }) }),
	LocationCreate,
]);

export const locationsUpsertDescription =
	'Create or replace a fulfillment location. Calls PUT /v1/locations/{id}. **When to use** — first-time listing setup (no locations exist yet) or restructuring (new warehouse / forwarder switch). Idempotent on `id` — re-upsert with same id replaces. **Inputs** — `id` (your stable key, becomes eBay\'s `merchantLocationKey`), `address: { line1, line2?, city, state, postalCode, country }` (ISO codes), optional `types: ["warehouse" | "store" | "home"]`, optional `geoCoordinates`. **Output** — full Location object. **Prereqs** — eBay seller account connected. **Example** — `{ id: "HOME", address: { line1: "123 Main St", city: "New York", state: "NY", postalCode: "10001", country: "US" } }`.';

export async function locationsUpsertExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const { id, ...body } = args as { id: string } & Record<string, unknown>;
	try {
		const client = getClient(config);
		return await client.locations.upsert(id, body as Parameters<typeof client.locations.upsert>[1]);
	} catch (err) {
		return toolErrorEnvelope(err, "locations_upsert_failed", `/v1/locations/${id}`);
	}
}

/* ------------------------ flipagent_locations_delete ----------------------- */

export const locationsDeleteInput = Type.Object({ id: Type.String({ minLength: 1 }) });

export const locationsDeleteDescription =
	'Delete a fulfillment location. Calls DELETE /v1/locations/{id}. **When to use** — permanently remove a location no longer in use. To temporarily stop using one (without deleting), prefer `flipagent_disable_location` so existing listings keep working. **Inputs** — `id`. **Output** — `{ id, removed: true }`. **Fails 412** if any active listing still references this `merchantLocationKey` — end / migrate those listings first. **Prereqs** — eBay seller account connected. **Example** — `{ id: "OLD_WAREHOUSE" }`.';

export async function locationsDeleteExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const id = String(args.id);
	try {
		const client = getClient(config);
		return await client.locations.delete(id);
	} catch (err) {
		return toolErrorEnvelope(err, "locations_delete_failed", `/v1/locations/${id}`);
	}
}

/* ------------------------ flipagent_locations_enable ----------------------- */

export const locationsEnableInput = Type.Object({ id: Type.String({ minLength: 1 }) });

export const locationsEnableDescription =
	'Enable a previously-disabled location so new listings can reference it. Calls POST /v1/locations/{id}/enable. **When to use** — bring a paused warehouse / address back online. **Inputs** — `id`. **Output** — `{ id, status: "enabled" }`. **Prereqs** — eBay seller account connected. **Example** — `{ id: "WAREHOUSE_NY" }`.';

export async function locationsEnableExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const id = String(args.id);
	try {
		const client = getClient(config);
		return await client.locations.enable(id);
	} catch (err) {
		return toolErrorEnvelope(err, "locations_enable_failed", `/v1/locations/${id}/enable`);
	}
}

/* ----------------------- flipagent_locations_disable ----------------------- */

export const locationsDisableInput = Type.Object({ id: Type.String({ minLength: 1 }) });

export const locationsDisableDescription =
	'Disable a location without deleting it. Calls POST /v1/locations/{id}/disable. **When to use** — temporarily stop new listings from referencing a warehouse (out for repairs, on vacation, etc.) while existing listings continue to ship from there. Reverse with `flipagent_enable_location`. **Inputs** — `id`. **Output** — `{ id, status: "disabled" }`. **Prereqs** — eBay seller account connected. **Example** — `{ id: "WAREHOUSE_NY" }`.';

export async function locationsDisableExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const id = String(args.id);
	try {
		const client = getClient(config);
		return await client.locations.disable(id);
	} catch (err) {
		return toolErrorEnvelope(err, "locations_disable_failed", `/v1/locations/${id}/disable`);
	}
}
