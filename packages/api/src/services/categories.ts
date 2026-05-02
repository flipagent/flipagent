/**
 * commerce/taxonomy reads — category tree + suggestions + per-category aspects.
 *
 *   getCategoryChildren(parentId?)  — top-level if no parentId, else children
 *   suggestCategory(title)          — title→category match
 *   getCategoryAspects(categoryId)  — required + recommended item-specifics
 *
 * Wraps eBay Commerce Taxonomy REST via the shared app-credential client.
 */

import type { CategoryAspect, CategoryNode, CategorySuggestion } from "@flipagent/types";
import { appRequest } from "./ebay/rest/app-client.js";
import { hashQuery } from "./shared/cache.js";
import { withCache } from "./shared/with-cache.js";

const DEFAULT_MARKETPLACE_ID = "EBAY_US";

interface TreeIdResponse {
	categoryTreeId: string;
}

let cachedTreeId: { id: string; expiresAt: number } | null = null;

async function getCategoryTreeId(marketplace?: string): Promise<string> {
	const ttlMs = 24 * 60 * 60 * 1000;
	if (cachedTreeId && cachedTreeId.expiresAt > Date.now()) return cachedTreeId.id;
	const res = await appRequest<TreeIdResponse>({
		path: `/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=${encodeURIComponent(marketplace ?? DEFAULT_MARKETPLACE_ID)}`,
	});
	cachedTreeId = { id: res.categoryTreeId, expiresAt: Date.now() + ttlMs };
	return res.categoryTreeId;
}

interface EbayCategorySubtree {
	category?: { categoryId: string; categoryName: string };
	parentCategoryTreeNodeHref?: string;
	categoryTreeNodeLevel?: number;
	leafCategoryTreeNode?: boolean;
	childCategoryTreeNodes?: EbayCategorySubtree[];
}

function flattenSubtree(
	node: EbayCategorySubtree,
	parentId: string | undefined,
	into: CategoryNode[],
	pathPrefix: string,
) {
	if (!node.category) return;
	const path = pathPrefix ? `${pathPrefix} > ${node.category.categoryName}` : node.category.categoryName;
	into.push({
		id: node.category.categoryId,
		name: node.category.categoryName,
		path,
		...(parentId ? { parentId } : {}),
		isLeaf: !!node.leafCategoryTreeNode,
	});
	for (const child of node.childCategoryTreeNodes ?? []) {
		flattenSubtree(child, node.category.categoryId, into, path);
	}
}

/**
 * eBay's category tree only bumps a couple of times a year, so 24h is a
 * safe TTL for both L1 (the full root subtree) and per-parent drills.
 * `withCache` shares the entry across users via `proxy_response_cache`,
 * so the first request of the day pays the eBay roundtrip and everyone
 * after that gets a ~10ms DB read.
 */
const CATEGORIES_CACHE_TTL_SEC = 24 * 60 * 60;

export async function getCategoryChildren(parentId: string | undefined, marketplace?: string): Promise<CategoryNode[]> {
	const mp = marketplace ?? DEFAULT_MARKETPLACE_ID;
	const path = parentId ? `commerce.taxonomy:children:${mp}:${parentId}` : `commerce.taxonomy:roots:${mp}`;
	const result = await withCache<CategoryNode[]>(
		{
			scope: "categories",
			ttlSec: CATEGORIES_CACHE_TTL_SEC,
			path,
			queryHash: hashQuery({ marketplace: mp, parentId: parentId ?? null }),
		},
		async () => ({ body: await fetchCategoryChildrenUpstream(parentId, marketplace), source: "rest" as const }),
	);
	return result.body;
}

async function fetchCategoryChildrenUpstream(
	parentId: string | undefined,
	marketplace?: string,
): Promise<CategoryNode[]> {
	const treeId = await getCategoryTreeId(marketplace);
	if (!parentId) {
		const tree = await appRequest<{ rootCategoryNode: EbayCategorySubtree }>({
			path: `/commerce/taxonomy/v1/category_tree/${treeId}`,
		});
		const out: CategoryNode[] = [];
		for (const child of tree.rootCategoryNode.childCategoryTreeNodes ?? []) {
			flattenSubtree(child, undefined, out, "");
		}
		return out.filter((n) => !n.parentId);
	}
	const subtree = await appRequest<{ categorySubtreeNode: EbayCategorySubtree }>({
		path: `/commerce/taxonomy/v1/category_tree/${treeId}/get_category_subtree?category_id=${encodeURIComponent(parentId)}`,
	});
	// Direct children only — `flattenSubtree` was recursing the entire
	// subtree, returning every descendant for parents like "Collectibles"
	// (3,500+ rows). Tree UIs lazy-load one level at a time, so we hand
	// back the immediate children and let the next click drill deeper.
	const out: CategoryNode[] = [];
	for (const child of subtree.categorySubtreeNode.childCategoryTreeNodes ?? []) {
		if (!child.category) continue;
		out.push({
			id: child.category.categoryId,
			name: child.category.categoryName,
			path: child.category.categoryName,
			parentId,
			isLeaf: !!child.leafCategoryTreeNode,
		});
	}
	return out;
}

interface SuggestResponse {
	categorySuggestions?: Array<{
		category: { categoryId: string; categoryName: string };
		categoryTreeNodeAncestors?: Array<{ categoryName: string }>;
	}>;
}

export async function suggestCategory(title: string, marketplace?: string): Promise<CategorySuggestion[]> {
	const treeId = await getCategoryTreeId(marketplace);
	const res = await appRequest<SuggestResponse>({
		path: `/commerce/taxonomy/v1/category_tree/${treeId}/get_category_suggestions?q=${encodeURIComponent(title)}`,
	});
	return (res.categorySuggestions ?? []).map((s) => ({
		id: s.category.categoryId,
		name: s.category.categoryName,
		...(s.categoryTreeNodeAncestors
			? {
					path: [
						...s.categoryTreeNodeAncestors.map((a) => a.categoryName).reverse(),
						s.category.categoryName,
					].join(" > "),
				}
			: {}),
	}));
}

interface AspectsResponse {
	aspects?: Array<{
		localizedAspectName: string;
		aspectConstraint?: {
			aspectRequired?: boolean;
			aspectMode?: string;
			aspectDataType?: string;
			itemToAspectCardinality?: string;
		};
		aspectValues?: Array<{ localizedValue: string }>;
	}>;
}

export async function getCategoryAspects(categoryId: string, marketplace?: string): Promise<CategoryAspect[]> {
	const treeId = await getCategoryTreeId(marketplace);
	const res = await appRequest<AspectsResponse>({
		path: `/commerce/taxonomy/v1/category_tree/${treeId}/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`,
	});
	return (res.aspects ?? []).map((a) => ({
		name: a.localizedAspectName,
		required: !!a.aspectConstraint?.aspectRequired,
		multiValued: a.aspectConstraint?.itemToAspectCardinality === "MULTI",
		...(a.aspectConstraint?.aspectDataType ? { dataType: a.aspectConstraint.aspectDataType } : {}),
		...(a.aspectValues?.length ? { values: a.aspectValues.map((v) => v.localizedValue) } : {}),
	}));
}
