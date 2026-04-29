/**
 * Two read-side taxonomy tools: get the default category tree id for a
 * marketplace, then get suggested categories or item aspects for that tree.
 * Backed by app-credential token at api.flipagent.dev (no user OAuth needed).
 */

import { Type } from "@sinclair/typebox";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

export const ebayTaxonomyDefaultIdInput = Type.Object({
	marketplaceId: Type.String({ default: "EBAY_US", description: "e.g. EBAY_US, EBAY_GB, EBAY_DE." }),
});

export const ebayTaxonomyDefaultIdDescription =
	"Get the default category tree id for an eBay marketplace (call this first before any other taxonomy method).";

export async function ebayTaxonomyDefaultIdExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.markets.taxonomy.defaultCategoryTreeId((args.marketplaceId as string) ?? "EBAY_US");
	} catch (err) {
		const e = toApiCallError(err, "/v1/commerce/taxonomy/get_default_category_tree_id");
		return { error: "taxonomy_failed", status: e.status, url: e.url, message: e.message };
	}
}

export const ebayTaxonomySuggestInput = Type.Object({
	categoryTreeId: Type.String(),
	q: Type.String({ description: "Free-text item description; eBay returns top category matches." }),
});

export const ebayTaxonomySuggestDescription =
	"Suggest the most likely eBay categories for a free-text query. Use this to pick a leaf category before creating a listing.";

export async function ebayTaxonomySuggestExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.markets.taxonomy.getCategorySuggestions(args.categoryTreeId as string, args.q as string);
	} catch (err) {
		const e = toApiCallError(err, "/v1/commerce/taxonomy/category_tree/{id}/get_category_suggestions");
		return { error: "taxonomy_failed", status: e.status, url: e.url, message: e.message };
	}
}

export const ebayTaxonomyAspectsInput = Type.Object({
	categoryTreeId: Type.String(),
	categoryId: Type.String(),
});

export const ebayTaxonomyAspectsDescription =
	"Get the required + recommended aspects for a leaf category — needed when building an inventory item before publish.";

export async function ebayTaxonomyAspectsExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.markets.taxonomy.getItemAspectsForCategory(
			args.categoryTreeId as string,
			args.categoryId as string,
		);
	} catch (err) {
		const e = toApiCallError(err, "/v1/commerce/taxonomy/category_tree/{id}/get_item_aspects_for_category");
		return { error: "taxonomy_failed", status: e.status, url: e.url, message: e.message };
	}
}
