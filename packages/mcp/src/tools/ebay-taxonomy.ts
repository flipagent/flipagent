/**
 * Read-side taxonomy tools — backed by `/v1/categories/*`.
 * Single category-tree concept (flipagent picks the marketplace tree
 * automatically); caller doesn't pass categoryTreeId.
 */

import { Type } from "@sinclair/typebox";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

export const ebayTaxonomyDefaultIdInput = Type.Object({
	marketplace: Type.Optional(Type.String({ default: "ebay" })),
});

export const ebayTaxonomyDefaultIdDescription =
	"List top-level categories for the marketplace. Calls GET /v1/categories. flipagent auto-resolves the underlying eBay tree id.";

export async function ebayTaxonomyDefaultIdExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.categories.list({
			marketplace: args.marketplace as never,
		});
	} catch (err) {
		const e = toApiCallError(err, "/v1/categories");
		return { error: "taxonomy_failed", status: e.status, url: e.url, message: e.message };
	}
}

export const ebayTaxonomySuggestInput = Type.Object({
	title: Type.String({ description: "Free-text item description; flipagent returns top category matches." }),
	marketplace: Type.Optional(Type.String({ default: "ebay" })),
});

export const ebayTaxonomySuggestDescription =
	"Suggest the most likely category for a free-text title. Calls GET /v1/categories/suggest. Use to pick a leaf category before creating a listing.";

export async function ebayTaxonomySuggestExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.categories.suggest({
			title: args.title as string,
			marketplace: args.marketplace as never,
		});
	} catch (err) {
		const e = toApiCallError(err, "/v1/categories/suggest");
		return { error: "taxonomy_failed", status: e.status, url: e.url, message: e.message };
	}
}

export const ebayTaxonomyAspectsInput = Type.Object({
	categoryId: Type.String(),
});

export const ebayTaxonomyAspectsDescription =
	"Get required + recommended aspects (item specifics) for a leaf category. Calls GET /v1/categories/{id}/aspects. Needed before creating a listing.";

export async function ebayTaxonomyAspectsExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.categories.aspects(args.categoryId as string);
	} catch (err) {
		const e = toApiCallError(err, "/v1/categories/{id}/aspects");
		return { error: "taxonomy_failed", status: e.status, url: e.url, message: e.message };
	}
}
