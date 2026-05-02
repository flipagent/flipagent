/**
 * Saved-search tools — query-based standing alerts. Backed by
 * `/v1/saved-searches`. Pair with `flipagent_watching_*` (item-level)
 * for full sourcing-radar coverage.
 */

import { SavedSearchCreate } from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

/* ------------------------ flipagent_saved_searches_list -------------------- */

export const savedSearchesListInput = Type.Object({});

export const savedSearchesListDescription =
	"List the api key's saved searches. GET /v1/saved-searches. Each saved search runs server-side on a schedule and surfaces new matches.";

export async function savedSearchesListExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.savedSearches.list();
	} catch (err) {
		const e = toApiCallError(err, "/v1/saved-searches");
		return { error: "saved_searches_list_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* ----------------------- flipagent_saved_searches_create ------------------- */

export { SavedSearchCreate as savedSearchesCreateInput };

export const savedSearchesCreateDescription =
	"Save a search query for ongoing monitoring. POST /v1/saved-searches. Required: `name`, `query` (q + filter same shape as `flipagent_items_search`). Optional: `notify` channel.";

export async function savedSearchesCreateExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.savedSearches.create(args as Parameters<typeof client.savedSearches.create>[0]);
	} catch (err) {
		const e = toApiCallError(err, "/v1/saved-searches");
		return { error: "saved_searches_create_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* ----------------------- flipagent_saved_searches_delete ------------------- */

export const savedSearchesDeleteInput = Type.Object({ id: Type.String({ minLength: 1 }) });

export const savedSearchesDeleteDescription = "Delete a saved search. DELETE /v1/saved-searches/{id}.";

export async function savedSearchesDeleteExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const id = String(args.id);
	try {
		const client = getClient(config);
		return await client.savedSearches.delete(id);
	} catch (err) {
		const e = toApiCallError(err, `/v1/saved-searches/${id}`);
		return { error: "saved_searches_delete_failed", status: e.status, url: e.url, message: e.message };
	}
}
