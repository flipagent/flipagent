/**
 * Price-markdown tools — scheduled or immediate markdowns on the
 * seller's listings. Lighter-weight than promotions (just a price
 * change, no banner / eligibility shape).
 */

import { PriceMarkdownCreate } from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

/* ------------------------- flipagent_markdowns_list ------------------------ */

export const markdownsListInput = Type.Object({});

export const markdownsListDescription =
	"List active + scheduled markdowns. GET /v1/markdowns. Each row carries `listingId`, original / markdown price, schedule.";

export async function markdownsListExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.markdowns.list();
	} catch (err) {
		const e = toApiCallError(err, "/v1/markdowns");
		return { error: "markdowns_list_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* ------------------------ flipagent_markdowns_create ----------------------- */

export { PriceMarkdownCreate as markdownsCreateInput };

export const markdownsCreateDescription =
	"Schedule a markdown on one listing. POST /v1/markdowns. Required: `listingId`, `priceCents`, optional `startsAt` / `endsAt`. Use after `flipagent_evaluate` re-runs and the active median has dropped.";

export async function markdownsCreateExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.markdowns.create(args as Parameters<typeof client.markdowns.create>[0]);
	} catch (err) {
		const e = toApiCallError(err, "/v1/markdowns");
		return { error: "markdowns_create_failed", status: e.status, url: e.url, message: e.message };
	}
}
