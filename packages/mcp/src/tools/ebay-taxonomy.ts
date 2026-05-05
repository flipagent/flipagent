/**
 * Read-side taxonomy tools — backed by `/v1/categories/*`.
 *
 * `marketplace` is the provider+region dispatch literal (snake_case).
 * Only `ebay_us` is wired today; the literal expands when more
 * adapters/regions land.
 */

import { Type } from "@sinclair/typebox";
import { getClient, toolErrorEnvelope } from "../client.js";
import type { Config } from "../config.js";

export const ebayTaxonomyDefaultIdInput = Type.Object({
	marketplace: Type.Optional(Type.String({ default: "ebay_us" })),
	parentId: Type.Optional(
		Type.String({
			description:
				"Return children of this category. Omit for top-level. Drill down by passing the parent's id; stop when nodes have isLeaf=true.",
		}),
	),
});

export const ebayTaxonomyDefaultIdDescription =
	"Walk the marketplace category tree by parent. Calls GET /v1/categories. **When to use** — explore the tree manually when `flipagent_suggest_category` doesn't pick a confident leaf (or when you want to confirm what categories *exist* under a node). For a known title, prefer `flipagent_suggest_category` — it's one call instead of N. **Inputs** — optional `marketplace` (default `ebay_us`; only `ebay_us` is wired today), optional `parentId` (omit for top level; pass a node id to drill in). **Output** — `{ categories: [{ id, name, parentId, isLeaf }] }`. Repeat with each non-leaf id until you hit `isLeaf: true` — only leaves are valid for `flipagent_create_listing.categoryId`. **Prereqs** — `FLIPAGENT_API_KEY`; no eBay OAuth needed. **Example** — call with `{}` for roots, then `{ parentId: \"625\" }` for Cameras & Photo's children.";

export async function ebayTaxonomyDefaultIdExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.categories.list({
			marketplace: args.marketplace as never,
			parentId: args.parentId as string | undefined,
		});
	} catch (err) {
		return toolErrorEnvelope(err, "categories_list_failed", "/v1/categories");
	}
}

export const ebayTaxonomySuggestInput = Type.Object({
	title: Type.String({ description: "Free-text item description; flipagent returns top category matches." }),
	marketplace: Type.Optional(Type.String({ default: "ebay_us" })),
});

export const ebayTaxonomySuggestDescription =
	'Suggest the most likely leaf category for a free-text title. Calls GET /v1/categories/suggest. **When to use** — first step before `flipagent_create_listing` to pick `categoryId`; one call instead of walking the tree manually. **Inputs** — `title` (item title or free-text description), optional `marketplace` (default `ebay_us`; only `ebay_us` is wired today). **Output** — `{ suggestions: [{ id, name, path }] }` in eBay\'s relevance order (top hit first). Take `suggestions[0].id` for the listing\'s `categoryId`; fall back to `flipagent_list_categories` to walk the tree if none feel right. `path` is the breadcrumb (e.g. `"Cell Phones & Accessories > Cell Phones & Smartphones"`) for human display. **Prereqs** — `FLIPAGENT_API_KEY`; no eBay OAuth needed. **Example** — `{ title: "canon ef 50mm f/1.8 stm autofocus lens" }`.';

export async function ebayTaxonomySuggestExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.categories.suggest({
			title: args.title as string,
			marketplace: args.marketplace as never,
		});
	} catch (err) {
		return toolErrorEnvelope(err, "categories_suggest_failed", "/v1/categories/suggest");
	}
}

export const ebayTaxonomyAspectsInput = Type.Object({
	categoryId: Type.String(),
});

export const ebayTaxonomyAspectsDescription =
	'Fetch required + recommended aspects ("item specifics") for a leaf category. Calls GET /v1/categories/{id}/aspects. **When to use** — required step before `flipagent_create_listing`: every leaf category demands a specific set of aspects (Brand, Model, Material…) and the api will reject a publish with `MissingPrereqError` if you skip required ones. **Inputs** — `categoryId` (a leaf — verify with `flipagent_list_categories` `isLeaf: true`). **Output** — `{ aspects: [{ name, dataType, required, allowedValues?: string[], cardinality }] }`. Map names → values for `flipagent_create_listing.aspects`. **Prereqs** — `FLIPAGENT_API_KEY`; no eBay OAuth needed. **Example** — `{ categoryId: "31388" }` for Camera Lenses → returns `Brand`, `Focal Length`, `Mount`, etc.';

export async function ebayTaxonomyAspectsExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.categories.aspects(args.categoryId as string);
	} catch (err) {
		return toolErrorEnvelope(err, "categories_aspects_failed", "/v1/categories/{id}/aspects");
	}
}
