#!/usr/bin/env tsx

/**
 * Nightly taxonomy prefetch. Fetches the full eBay category tree via
 * Trading `GetCategories` (separate per-app daily bucket from REST)
 * and warms `proxy_response_cache` so subsequent
 * /v1/commerce/taxonomy/category_tree/{id} REST calls are served
 * locally for ~30 days.
 *
 * Run via cron / Container Apps job:
 *   tsx packages/api/src/scripts/prefetch-taxonomy.ts EBAY_US
 *
 * Auth: needs a connected seller's user OAuth token. The script picks
 * the most recently used api_keys.user_id with an eBay account hooked
 * up. (Trading IAF accepts a REST OAuth access token for any user
 * authorized for the relevant scopes; the data we fetch is global, not
 * user-specific.)
 */

import { desc, isNotNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { apiKeys } from "../db/schema.js";
import { getUserAccessToken } from "../services/ebay/oauth.js";
import { getCategoriesTree } from "../services/ebay/trading/categories.js";
import { hashQuery, setCached } from "../services/shared/cache.js";

const MARKETPLACE_TO_SITE: Record<string, string> = {
	EBAY_US: "0",
	EBAY_GB: "3",
	EBAY_DE: "77",
	EBAY_AU: "15",
	EBAY_CA: "2",
};

const TREE_ID_BY_MARKETPLACE: Record<string, string> = {
	EBAY_US: "0",
	EBAY_GB: "3",
	EBAY_DE: "77",
	EBAY_AU: "15",
	EBAY_CA: "2",
};

async function pickUserToken(): Promise<string> {
	// Any seller with eBay connected works — the data is global, not
	// per-user. We pick the most recently active key to maximise the
	// chance the refresh token still validates.
	const rows = await db
		.select({ id: apiKeys.id })
		.from(apiKeys)
		.where(isNotNull(apiKeys.userId))
		.orderBy(desc(apiKeys.lastUsedAt))
		.limit(20);
	for (const row of rows) {
		try {
			return await getUserAccessToken(row.id);
		} catch {}
	}
	throw new Error("no api key with a connected eBay account found.");
}

async function main(): Promise<void> {
	const marketplace = process.argv[2] ?? "EBAY_US";
	const siteId = MARKETPLACE_TO_SITE[marketplace];
	const treeId = TREE_ID_BY_MARKETPLACE[marketplace];
	if (!siteId || !treeId) {
		console.error(`unknown marketplace: ${marketplace}. supported: ${Object.keys(MARKETPLACE_TO_SITE).join(", ")}`);
		process.exit(1);
	}
	console.log(`[prefetch] fetching ${marketplace} category tree via Trading…`);
	const accessToken = await pickUserToken();
	const t0 = Date.now();
	const { version, rows } = await getCategoriesTree({ accessToken, siteId, categorySiteId: siteId });
	console.log(`[prefetch] got ${rows.length} categories (version ${version}) in ${Date.now() - t0}ms`);

	// Warm the REST shape that Commerce Taxonomy returns for
	// `category_tree/{id}` so the lazy cache-first wrapper sees a hit
	// on next request. We synthesise the same nesting eBay returns —
	// `CategoryTreeNode { category: { categoryId, categoryName }, childCategoryTreeNodes: [...] }`.
	const nodesById = new Map<string, ReturnType<typeof toNode>>();
	for (const r of rows) nodesById.set(r.categoryId, toNode(r));
	for (const r of rows) {
		if (!r.parentId) continue;
		const child = nodesById.get(r.categoryId);
		const parent = nodesById.get(r.parentId);
		if (child && parent && r.parentId !== r.categoryId) {
			parent.childCategoryTreeNodes ??= [];
			parent.childCategoryTreeNodes.push(child);
		}
	}
	const root = rows.find((r) => !r.parentId || r.parentId === r.categoryId);
	const treeNode = root ? nodesById.get(root.categoryId) : undefined;
	if (!treeNode) throw new Error("could not assemble tree from rows");
	const treeBody = {
		categoryTreeId: treeId,
		categoryTreeVersion: version ?? "1",
		rootCategoryNode: treeNode,
	};
	const treePath = `/v1/commerce/taxonomy/category_tree/${treeId}`;
	const treeKey = hashQuery({ q: "" });
	await setCached(treePath, treeKey, treeBody, "taxonomy:tree:prefetched", 30 * 24 * 60 * 60);
	console.log(`[prefetch] warmed ${treePath} (${rows.length} nodes)`);

	// And the default tree id endpoint (super common first call).
	const defaultIdBody = { categoryTreeId: treeId, categoryTreeVersion: version ?? "1" };
	const defaultIdPath = "/v1/commerce/taxonomy/get_default_category_tree_id";
	const defaultIdKey = hashQuery({ q: `marketplace_id=${marketplace}` });
	await setCached(defaultIdPath, defaultIdKey, defaultIdBody, "taxonomy:default_id:prefetched", 90 * 24 * 60 * 60);
	console.log(`[prefetch] warmed ${defaultIdPath}?marketplace_id=${marketplace}`);
}

interface CategoryNode {
	category: { categoryId: string; categoryName: string };
	childCategoryTreeNodes?: CategoryNode[];
	categoryTreeNodeLevel: number;
	leafCategoryTreeNode?: boolean;
}

function toNode(r: { categoryId: string; name: string; level: number; leaf: boolean }): CategoryNode {
	return {
		category: { categoryId: r.categoryId, categoryName: r.name },
		categoryTreeNodeLevel: r.level,
		...(r.leaf ? { leafCategoryTreeNode: true } : {}),
	};
}

main().catch((err) => {
	console.error("[prefetch] failed:", err);
	process.exit(1);
});
