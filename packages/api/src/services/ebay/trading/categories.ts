/**
 * Trading API: bulk category tree dump.
 *
 * Why this exists: REST `/commerce/taxonomy/v1/category_tree/{id}`
 * counts against the per-app daily call cap (default 5K/day, shared
 * across all our hosted users). Trading `GetCategories` lives in a
 * SEPARATE bucket — same daily limit but its own pool — so we can
 * use it once a night to refresh the entire EBAY_US tree without
 * touching the REST cap at all.
 *
 * The returned XML is large (~5MB for full US). Caller normally
 * parses + persists it, then hands subsequent reads via cache.
 */

import { arrayify, parseTrading, stringFrom, tradingCall } from "./client.js";

export interface CategoryRow {
	categoryId: string;
	parentId: string | null;
	name: string;
	level: number;
	leaf: boolean;
}

export async function getCategoriesTree(args: {
	accessToken: string;
	siteId?: string; // 0 = US (default)
	categorySiteId?: string;
	levelLimit?: number;
}): Promise<{ version: string | null; rows: CategoryRow[] }> {
	const body = `<?xml version="1.0" encoding="utf-8"?>
<GetCategoriesRequest xmlns="urn:ebay:apis:eBLBaseComponents">
	<DetailLevel>ReturnAll</DetailLevel>
	<CategorySiteID>${args.categorySiteId ?? "0"}</CategorySiteID>
	${args.levelLimit != null ? `<LevelLimit>${args.levelLimit}</LevelLimit>` : ""}
	<ViewAllNodes>true</ViewAllNodes>
</GetCategoriesRequest>`;
	const xml = await tradingCall({
		callName: "GetCategories",
		accessToken: args.accessToken,
		body,
		siteId: args.siteId ?? "0",
	});
	const parsed = parseTrading(xml, "GetCategories");
	const arr = (parsed.CategoryArray ?? {}) as Record<string, unknown>;
	const cats = arrayify(arr.Category);
	const rows = cats.map<CategoryRow>((c) => {
		const level = stringFrom(c.CategoryLevel);
		return {
			categoryId: stringFrom(c.CategoryID) ?? "",
			parentId: stringFrom(c.CategoryParentID),
			name: stringFrom(c.CategoryName) ?? "",
			level: level != null ? Number(level) : 0,
			leaf: c.LeafCategory === true || c.LeafCategory === "true",
		};
	});
	return { version: stringFrom(parsed.CategoryVersion), rows };
}
