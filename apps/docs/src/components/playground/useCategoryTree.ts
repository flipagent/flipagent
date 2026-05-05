/**
 * Shared eBay category-tree fetcher + localStorage cache. Used by
 * PlaygroundSourcing (left tree pane) and PlaygroundSearch (popover
 * picker on the filter row). The category tree is near-static — eBay
 * bumps `categoryTreeVersion` quarterly at most — so we persist L1 +
 * every drilled subtree per browser with a 6h TTL. The server still
 * runs its own 24h DB cache, so even on a miss the upstream eBay call
 * is rare.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { apiBase } from "../../lib/authClient";

export interface CategoryNode {
	id: string;
	name: string;
	path?: string;
	parentId?: string;
	isLeaf?: boolean;
}

const CATEGORY_CACHE_VERSION = 1;
const CATEGORY_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const CATEGORY_CACHE_KEY = (parentId?: string) =>
	`flipagent:cat:v${CATEGORY_CACHE_VERSION}:US:${parentId ?? "_root"}`;

interface CategoryCacheEntry {
	cachedAt: number;
	nodes: CategoryNode[];
}

function readCategoryCache(parentId?: string): CategoryNode[] | null {
	if (typeof window === "undefined") return null;
	try {
		const raw = window.localStorage.getItem(CATEGORY_CACHE_KEY(parentId));
		if (!raw) return null;
		const entry = JSON.parse(raw) as CategoryCacheEntry;
		if (!entry?.cachedAt || Date.now() - entry.cachedAt > CATEGORY_CACHE_TTL_MS) return null;
		return entry.nodes ?? null;
	} catch {
		return null;
	}
}

function writeCategoryCache(parentId: string | undefined, nodes: CategoryNode[]): void {
	if (typeof window === "undefined") return;
	try {
		const entry: CategoryCacheEntry = { cachedAt: Date.now(), nodes };
		window.localStorage.setItem(CATEGORY_CACHE_KEY(parentId), JSON.stringify(entry));
	} catch {
		// Quota exceeded / private mode — silently fall back to network.
	}
}

async function fetchCategoriesNetwork(parentId?: string): Promise<CategoryNode[]> {
	const url = `${apiBase}/v1/categories${parentId ? `?parentId=${encodeURIComponent(parentId)}` : ""}`;
	const r = await fetch(url, { credentials: "include" });
	if (!r.ok) throw new Error(`categories ${r.status}`);
	const j = (await r.json()) as { categories?: CategoryNode[] };
	const nodes = j.categories ?? [];
	writeCategoryCache(parentId, nodes);
	return nodes;
}

export async function fetchCategories(parentId?: string): Promise<CategoryNode[]> {
	const cached = readCategoryCache(parentId);
	if (cached) {
		// Background refresh — keep the cache warm without making the user wait.
		fetchCategoriesNetwork(parentId).catch(() => {
			/* network blip; keep cache */
		});
		return cached;
	}
	return fetchCategoriesNetwork(parentId);
}

/**
 * Sync lookup of a category's pretty name from the localStorage cache.
 * Used by `wireToSearchQuery` (in `SearchFilters.tsx`) on `reopen` so
 * the picker chip shows "Wristwatches" instead of "31387". Returns
 * undefined when the id isn't in any cached subtree — the caller falls
 * back to the id, and the picker can re-resolve when the user opens
 * the tree (which fetches the missing branch).
 *
 * No async. Walks every cached entry once; tiny in practice (a user's
 * cache holds at most a few hundred nodes — root + a handful of
 * expanded branches).
 */
export function lookupCachedCategoryName(id: string): string | undefined {
	if (!id || typeof window === "undefined") return undefined;
	for (let i = 0; i < window.localStorage.length; i++) {
		const key = window.localStorage.key(i);
		if (!key?.startsWith(`flipagent:cat:v${CATEGORY_CACHE_VERSION}:`)) continue;
		try {
			const raw = window.localStorage.getItem(key);
			if (!raw) continue;
			const entry = JSON.parse(raw) as CategoryCacheEntry;
			const found = entry.nodes?.find((n) => n.id === id);
			if (found) return found.name;
		} catch {
			// Corrupt entry — ignore.
		}
	}
	return undefined;
}

export interface CategoryTreeState {
	roots: CategoryNode[] | null;
	childrenByParent: Map<string, CategoryNode[]>;
	expanded: Set<string>;
	loading: Set<string>;
	error: boolean;
	toggleExpanded: (node: CategoryNode) => Promise<void>;
	loadChildren: (node: CategoryNode) => Promise<CategoryNode[]>;
}

/**
 * Drives a category tree: loads roots on mount, expands branches on
 * demand, caches results in localStorage. Caller renders the UI; this
 * hook owns state.
 */
export function useCategoryTree(opts: { skip?: boolean } = {}): CategoryTreeState {
	const [roots, setRoots] = useState<CategoryNode[] | null>(null);
	const [childrenByParent, setChildrenByParent] = useState<Map<string, CategoryNode[]>>(new Map());
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [loading, setLoading] = useState<Set<string>>(new Set());
	const [error, setError] = useState(false);
	const skip = opts.skip ?? false;
	const mountedRef = useRef(true);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	useEffect(() => {
		if (skip) return;
		fetchCategories()
			.then((nodes) => {
				if (mountedRef.current) setRoots(nodes);
			})
			.catch(() => {
				if (mountedRef.current) {
					setRoots([]);
					setError(true);
				}
			});
	}, [skip]);

	const loadChildren = useCallback(
		async (node: CategoryNode): Promise<CategoryNode[]> => {
			const cached = childrenByParent.get(node.id);
			if (cached) return cached;
			setLoading((s) => new Set(s).add(node.id));
			try {
				const kids = await fetchCategories(node.id);
				if (mountedRef.current) {
					setChildrenByParent((prev) => new Map(prev).set(node.id, kids));
				}
				return kids;
			} finally {
				if (mountedRef.current) {
					setLoading((s) => {
						const n = new Set(s);
						n.delete(node.id);
						return n;
					});
				}
			}
		},
		[childrenByParent],
	);

	const toggleExpanded = useCallback(
		async (node: CategoryNode): Promise<void> => {
			if (expanded.has(node.id)) {
				setExpanded((prev) => {
					const n = new Set(prev);
					n.delete(node.id);
					return n;
				});
				return;
			}
			if (!childrenByParent.has(node.id)) {
				try {
					await loadChildren(node);
				} catch {
					/* swallow — empty branch */
				}
			}
			if (mountedRef.current) {
				setExpanded((prev) => new Set(prev).add(node.id));
			}
		},
		[expanded, childrenByParent, loadChildren],
	);

	return { roots, childrenByParent, expanded, loading, error, toggleExpanded, loadChildren };
}
