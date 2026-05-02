/**
 * Watch-list tools — listings the api key is tracking. Backed by
 * `/v1/watching`. Pair with `flipagent_saved_searches_*` for query-
 * based deal alerts; this is item-by-item.
 */

import { WatchAddRequest } from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

/* -------------------------- flipagent_watching_list ------------------------ */

export const watchingListInput = Type.Object({});

export const watchingListDescription =
	"List the items currently on the watch-list. GET /v1/watching. Use to check progress on a sourcing shortlist or to remind a user what they're tracking.";

export async function watchingListExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.watching.list();
	} catch (err) {
		const e = toApiCallError(err, "/v1/watching");
		return { error: "watching_list_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* -------------------------- flipagent_watching_watch ----------------------- */

export { WatchAddRequest as watchingWatchInput };

export const watchingWatchDescription =
	"Add an item to the watch-list. POST /v1/watching. Use after `flipagent_evaluate` returns a `hold` rating — keep eyes on it without committing capital.";

export async function watchingWatchExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.watching.watch(args as Parameters<typeof client.watching.watch>[0]);
	} catch (err) {
		const e = toApiCallError(err, "/v1/watching");
		return { error: "watching_watch_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* ------------------------- flipagent_watching_unwatch ---------------------- */

export const watchingUnwatchInput = Type.Object({ itemId: Type.String({ minLength: 1 }) });

export const watchingUnwatchDescription = "Remove an item from the watch-list. DELETE /v1/watching/{itemId}.";

export async function watchingUnwatchExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const itemId = String(args.itemId);
	try {
		const client = getClient(config);
		return await client.watching.unwatch(itemId);
	} catch (err) {
		const e = toApiCallError(err, `/v1/watching/${itemId}`);
		return { error: "watching_unwatch_failed", status: e.status, url: e.url, message: e.message };
	}
}
