/**
 * Sourcing — top-down market navigator.
 *
 * The reseller's "where do I work this week" surface. Walks eBay's
 * category tree as a navigable hierarchy; clicking a node loads active
 * listings in that scope so the user can scan from "Toys & Hobbies"
 * down to "Pokémon Sealed Boxes" without typing a query first.
 *
 * Fast path: tree click → `/v1/items/search` active → live listings,
 * ~200ms. Query box narrows results within the selected node
 * (Run/Enter). Per-row drawer opens Evaluate inline.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { apiBase } from '../../lib/authClient';
import { ComposeCard, ComposeTabs, type ComposeTab } from '../compose/ComposeCard';
import { playgroundApi } from './api';
import { MOCK_LISTINGS_BY_CATEGORY, MOCK_SOURCING_ROOTS } from './mockSourcing';
import { RowDrawer } from './RowDrawer';
import {
  EMPTY_SEARCH_QUERY,
  SearchFilters,
  type SearchQuery,
  searchQueryToWire,
} from './SearchFilters';
import { SearchResult, type SearchOutcome } from './SearchResult';
import type { BrowseSearchResponse, ItemSummary } from './types';

/* ----------------------------- types ----------------------------- */

type CategoryNode = {
  id: string;
  name: string;
  path?: string;
  parentId?: string;
  isLeaf?: boolean;
};

/* ----------------------------- helpers ----------------------------- */

/**
 * Client-side cache for the eBay category tree. Categories almost never
 * change (eBay bumps `categoryTreeVersion` quarterly at most), so we
 * persist L1 + every drilled subtree in localStorage with a 6h TTL.
 * Refresh feels instant; the network refill happens once per ~6h per
 * browser. Server still does its own 24h DB cache, so even on a miss
 * the upstream eBay call is rare.
 */
const CATEGORY_CACHE_VERSION = 1;
const CATEGORY_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const CATEGORY_CACHE_KEY = (parentId?: string) => `flipagent:cat:v${CATEGORY_CACHE_VERSION}:US:${parentId ?? "_root"}`;

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
  const url = `${apiBase}/v1/categories${parentId ? `?parentId=${encodeURIComponent(parentId)}` : ''}`;
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(`categories ${r.status}`);
  const j = (await r.json()) as { categories?: CategoryNode[] };
  const nodes = j.categories ?? [];
  writeCategoryCache(parentId, nodes);
  return nodes;
}

async function fetchCategories(parentId?: string): Promise<CategoryNode[]> {
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

/* ----------------------------- component ----------------------------- */

/** Tiny abortable sleep — matches the mock-evaluate pipeline's pattern. */
function mockDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException('aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function PlaygroundSourcing<TabId extends string = string>({
  tabsProps,
  mockMode = false,
  compact = false,
}: {
  tabsProps: {
    tabs: ReadonlyArray<ComposeTab<TabId>>;
    active: TabId;
    onChange: (next: TabId) => void;
  };
  /** When true, replace network I/O with canned fixtures and synthetic delays. */
  mockMode?: boolean;
  /** When true, collapse the left tree pane into a horizontal chip strip (hero / narrow card). */
  compact?: boolean;
}) {
  const [roots, setRoots] = useState<CategoryNode[] | null>(null);
  const [childrenByParent, setChildrenByParent] = useState<Map<string, CategoryNode[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<CategoryNode | null>(null);
  // Full SearchQuery shape so the right pane can drop in the same
  // SearchFilters surface as the standalone Search panel. `q` drives
  // the narrow-within input; `category` mirrors `selected`; the rest
  // (mode/sort/conditions/etc.) come from SearchFilters chips.
  const [searchQuery, setSearchQuery] = useState<SearchQuery>(EMPTY_SEARCH_QUERY);
  const [listings, setListings] = useState<BrowseSearchResponse | null>(null);
  const [offset, setOffset] = useState(0);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Drawer item — clicking a listings row sets it; the drawer fires
  // Evaluate from inside without leaving Sourcing. Cleared on pagination
  // / refetch so the drawer never lingers on a stale row that's no
  // longer in view.
  const [drawerItem, setDrawerItem] = useState<ItemSummary | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const rootsErrRef = useRef(false);

  useEffect(() => {
    if (mockMode) {
      // Logged-out hero — synthesize a chip strip of "leaf" categories
      // from the canned roots. No localStorage, no network.
      setRoots([...MOCK_SOURCING_ROOTS]);
      return () => {
        abortRef.current?.abort();
      };
    }
    fetchCategories()
      .then(setRoots)
      .catch(() => {
        rootsErrRef.current = true;
        setRoots([]);
        // PaneError owns the headline; this string is the body / recovery
        // hint. Mid-fetch failures (selected node) use the same `err`
        // slot but render inline below the listings, where a single
        // sentence reads fine on its own.
        setErr("Refresh the page, or sign in to retry.");
      });
    return () => {
      abortRef.current?.abort();
    };
  }, [mockMode]);

  async function loadChildren(node: CategoryNode): Promise<CategoryNode[]> {
    const cached = childrenByParent.get(node.id);
    if (cached) return cached;
    setLoading((s) => new Set(s).add(node.id));
    try {
      const kids = await fetchCategories(node.id);
      setChildrenByParent((prev) => new Map(prev).set(node.id, kids));
      return kids;
    } finally {
      setLoading((s) => {
        const n = new Set(s);
        n.delete(node.id);
        return n;
      });
    }
  }

  async function pick(node: CategoryNode, queryOverride?: SearchQuery) {
    setSelected(node);
    setListings(null);
    setErr(null);
    setOffset(0);
    setDrawerItem(null);
    // Sync the searchQuery's category to the picked node so SearchFilters
    // (and the API call) see the same selection.
    const baseQuery = queryOverride ?? searchQuery;
    const nextQuery: SearchQuery = {
      ...baseQuery,
      category: { id: node.id, name: node.name },
    };
    if (!queryOverride) setSearchQuery(nextQuery);
    if (!node.isLeaf) {
      if (!childrenByParent.has(node.id)) {
        try {
          await loadChildren(node);
        } catch {
          /* swallow — chips will just be empty */
        }
      }
      setExpanded((prev) => new Set(prev).add(node.id));
      // Meta-category landing — eBay's `/b/<slug>/<id>` page renders
      // subcategory tiles, not items, so a no-keyword fetch here always
      // returns 0 and the empty SearchResult message reads as a bug.
      // Skip the fetch and let `MetaCategoryPrompt` nudge the user to
      // drill in. A keyword refinement still goes through — the SRP
      // keyword path rolls up across the meta cat just fine.
      if (!nextQuery.q.trim()) return;
    }
    await fetchSample(node, nextQuery, 0);
  }

  async function fetchSample(node: CategoryNode, sq: SearchQuery, nextOffset: number) {
    setPending(true);
    setErr(null);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (mockMode) {
      try {
        // Synthetic 220ms — matches the real fast-path roughly so the
        // skeleton flicker reads as "loaded" rather than instant-snap.
        await mockDelay(220, controller.signal);
        const listingsFixture = MOCK_LISTINGS_BY_CATEGORY[node.id];
        if (!listingsFixture) {
          setErr("No listings in this demo category.");
        } else {
          setListings(listingsFixture);
          setOffset(0);
        }
      } catch {
        /* aborted — leave state alone */
      } finally {
        if (!controller.signal.aborted) setPending(false);
      }
      return;
    }
    try {
      // Force the call against the picked node. SearchFilters' own
      // category state is kept in sync via `pick`, but using
      // `node.id` here is the load-bearing source of truth.
      const target: SearchQuery = { ...sq, category: { id: node.id, name: node.name } };
      const plan = playgroundApi.search(searchQueryToWire(target, nextOffset));
      const r = await plan.exec();
      if (controller.signal.aborted) return;
      if (!r.ok) {
        setErr("Couldn't load listings for this category.");
        return;
      }
      setListings(r.body as BrowseSearchResponse);
      setOffset(nextOffset);
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  }

  function toggleNode(node: CategoryNode) {
    if (node.isLeaf) {
      void pick(node);
      return;
    }
    if (expanded.has(node.id) && selected?.id === node.id) {
      setExpanded((prev) => {
        const n = new Set(prev);
        n.delete(node.id);
        return n;
      });
      return;
    }
    void pick(node);
  }

  function runQuery() {
    if (!selected) return;
    setOffset(0);
    setDrawerItem(null);
    void fetchSample(selected, searchQuery, 0);
  }

  /**
   * SearchFilters change → mirror into searchQuery and immediately
   * re-fetch (filter clicks are discrete, unlike typing). Skips the
   * narrow-within `q` path because Enter is what triggers that.
   */
  function applyFilters(next: SearchQuery) {
    setSearchQuery(next);
    if (!selected) return;
    // Same meta-category guard as pick() — landing pages have no items.
    if (!selected.isLeaf && !next.q.trim()) {
      setListings(null);
      return;
    }
    void fetchSample(selected, next, 0);
  }

  const totalActive = listings?.total;
  const pathText = selected ? selected.path ?? selected.name : null;

  return (
    <ComposeCard width={compact ? 'narrow' : 'wide'}>
      <ComposeTabs tabs={tabsProps.tabs} active={tabsProps.active} onChange={tabsProps.onChange} />

      {/* Path / status strip — refinement actions live in NodeDetail below. */}
      <div className="flex items-center gap-2.5 px-5 py-2.5 border-b border-[var(--border-faint)] bg-[color:var(--bg-soft)]/40 max-sm:px-4">
        <svg
          width="13"
          height="13"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-[var(--text-3)] shrink-0"
          aria-hidden="true"
        >
          <circle cx="3" cy="3" r="1" />
          <path d="M3 4v9" />
          <path d="M3 8h5" />
          <path d="M3 12h5" />
          <circle cx="10" cy="8" r="1" />
          <circle cx="10" cy="12" r="1" />
        </svg>
        <span className="text-[12.5px] text-[var(--text-2)] truncate">{pathText ?? 'Pick a category'}</span>
        <div className="ml-auto flex items-center gap-3 shrink-0">
          {totalActive !== undefined && (
            <span className="text-[11px] font-mono text-[var(--text-3)]">{totalActive.toLocaleString()} active</span>
          )}
        </div>
      </div>

      {compact ? (
        <div className="flex flex-col">
          <CategoryChipStrip
            roots={roots}
            selectedId={selected?.id ?? null}
            onPick={toggleNode}
          />
          <div className="overflow-y-auto max-h-[560px]">
            {!selected && !err && <EmptyPanePrompt compact />}
            {!selected && err && <PaneError message={err} />}
            {selected && (
              <NodeDetail
                node={selected}
                listings={listings}
                pending={pending}
                offset={offset}
                onPage={(next) => {
                  setDrawerItem(null);
                  void fetchSample(selected, searchQuery, next);
                }}
                searchQuery={searchQuery}
                onSearchQueryChange={applyFilters}
                onKeywordChange={(v) => setSearchQuery((prev) => ({ ...prev, q: v }))}
                onRunQuery={runQuery}
                drawerItem={drawerItem}
                onSelectItem={setDrawerItem}
                onCloseDrawer={() => setDrawerItem(null)}
                drawerMockMode={mockMode}
              />
            )}
            {selected && err && (
              <p className="mt-3 px-5 max-sm:px-4 text-[13px] text-[#c0392b]">{err}</p>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-[280px_1fr] max-sm:grid-cols-1 min-h-[440px]">
          <div className="border-r border-[var(--border-faint)] py-2 overflow-y-auto max-h-[640px] max-sm:border-r-0 max-sm:border-b max-sm:max-h-[300px]">
            {roots === null ? (
              <TreeSkeleton />
            ) : roots.length === 0 ? (
              rootsErrRef.current ? <TreeSkeleton stalled /> : <TreePaneEmpty />
            ) : (
              <TreeBranch
                nodes={roots}
                level={0}
                expanded={expanded}
                loading={loading}
                childrenByParent={childrenByParent}
                selectedId={selected?.id ?? null}
                onToggle={toggleNode}
              />
            )}
          </div>

          <div className="overflow-y-auto max-h-[640px] max-sm:max-h-none">
            {!selected && !err && <EmptyPanePrompt />}
            {!selected && err && <PaneError message={err} />}
            {selected && (
              <NodeDetail
                node={selected}
                listings={listings}
                pending={pending}
                offset={offset}
                onPage={(next) => {
                  setDrawerItem(null);
                  void fetchSample(selected, searchQuery, next);
                }}
                searchQuery={searchQuery}
                onSearchQueryChange={applyFilters}
                onKeywordChange={(v) => setSearchQuery((prev) => ({ ...prev, q: v }))}
                onRunQuery={runQuery}
                drawerItem={drawerItem}
                onSelectItem={setDrawerItem}
                onCloseDrawer={() => setDrawerItem(null)}
                drawerMockMode={mockMode}
              />
            )}
            {selected && err && (
              <p className="mt-3 px-5 max-sm:px-4 text-[13px] text-[#c0392b]">{err}</p>
            )}
          </div>
        </div>
      )}
    </ComposeCard>
  );
}

/**
 * Compact-mode replacement for the left tree pane — a horizontal strip
 * of category chips. Default state: one line, only chips that fit fully
 * are visible; overflow chips are hidden cleanly and the trailing
 * "+N" button shows the hidden count + expands the strip into a
 * wrapped grid. Expanded → wraps, all chips visible, "Less" collapses.
 * Click chip → pick (same handler the tree uses), so all downstream
 * logic (fetch, scores, drawer) is identical to the wide layout.
 */
function CategoryChipStrip({
  roots,
  selectedId,
  onPick,
}: {
  roots: CategoryNode[] | null;
  selectedId: string | null;
  onPick: (n: CategoryNode) => void;
}) {
  const [stripExpanded, setStripExpanded] = useState(false);
  const [hiddenCount, setHiddenCount] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const trailingBtnRef = useRef<HTMLButtonElement>(null);

  // Measure which chips fit on a single line; hide the rest. Re-runs on
  // viewport resize so resizing the window relayouts cleanly. Skipped when
  // the strip is expanded (everything is supposed to be visible there).
  //
  // No explicit "reserve" for the trailing button — when the button is
  // rendered, it sits as a sibling outside this container, so flex-1 has
  // already shrunk `containerRect.right` to exclude the button's width
  // and gap. Subtracting again was double-counting and cutting one chip
  // too early. Convergence is two passes: first pass (no button yet) may
  // pick a slightly higher fit count, the ResizeObserver fires when the
  // button appears and shrinks the container, second pass locks in the
  // final count. Both happen pre-paint via useLayoutEffect + sync RO.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !roots || roots.length === 0) return;
    if (stripExpanded) {
      // Reset every chip to its natural display while the strip wraps.
      for (const chip of chipRefs.current) if (chip) chip.style.display = '';
      setHiddenCount(0);
      return;
    }

    const measure = () => {
      // Reset to baseline so measurement reads true geometry.
      for (const chip of chipRefs.current) if (chip) chip.style.display = '';
      const containerRect = container.getBoundingClientRect();
      // Half-px epsilon absorbs subpixel rounding so a chip that *just*
      // touches the container edge isn't spuriously marked overflowing.
      const fitRight = containerRect.right + 0.5;
      let firstHidden = -1;
      for (let i = 0; i < chipRefs.current.length; i++) {
        const chip = chipRefs.current[i];
        if (!chip) continue;
        const r = chip.getBoundingClientRect();
        if (r.right > fitRight) {
          firstHidden = i;
          break;
        }
      }
      if (firstHidden >= 0) {
        for (let i = firstHidden; i < chipRefs.current.length; i++) {
          const chip = chipRefs.current[i];
          if (chip) chip.style.display = 'none';
        }
        setHiddenCount(roots.length - firstHidden);
      } else {
        setHiddenCount(0);
      }
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    return () => ro.disconnect();
  }, [roots, stripExpanded]);

  if (roots === null) {
    return (
      <div className="flex items-center gap-1.5 px-5 py-2 border-b border-[var(--border-faint)] overflow-hidden max-sm:px-4">
        {[88, 110, 96].map((w) => (
          <span
            key={w}
            className="h-7 shrink-0 rounded-[6px] bg-[var(--border-faint)] animate-pulse"
            style={{ width: `${w}px` }}
            aria-hidden="true"
          />
        ))}
      </div>
    );
  }
  if (roots.length === 0) {
    return (
      <div className="px-5 py-2 border-b border-[var(--border-faint)] text-[12px] text-[var(--text-3)] max-sm:px-4">
        No categories.
      </div>
    );
  }

  // Trailing button only renders when there's something to do — overflow to
  // expand, or a wrapped strip to collapse. Otherwise the strip is clean.
  const showTrailingButton = stripExpanded || hiddenCount > 0;

  return (
    <div className="flex items-start gap-2 px-5 py-2 border-b border-[var(--border-faint)] max-sm:px-4">
      <div
        ref={containerRef}
        className={`flex flex-1 items-center gap-1.5 min-w-0 ${
          stripExpanded ? 'flex-wrap' : 'flex-nowrap overflow-hidden'
        }`}
      >
        {roots.map((n, i) => {
          const isSelected = selectedId === n.id;
          return (
            <button
              key={n.id}
              ref={(el) => {
                chipRefs.current[i] = el;
              }}
              type="button"
              onClick={() => onPick(n)}
              className={`shrink-0 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[6px] text-[12px] border transition-colors duration-100 cursor-pointer ${
                isSelected
                  ? 'border-[var(--brand)] text-[var(--brand)] bg-[var(--brand-soft)]'
                  : 'border-[var(--border-faint)] text-[var(--text-2)] hover:text-[var(--text)] hover:border-[var(--border)]'
              }`}
            >
              {n.name}
            </button>
          );
        })}
      </div>
      {showTrailingButton && (
        <button
          ref={trailingBtnRef}
          type="button"
          onClick={() => setStripExpanded((e) => !e)}
          aria-expanded={stripExpanded}
          aria-label={stripExpanded ? 'Show fewer categories' : `Show ${hiddenCount} more categories`}
          className="shrink-0 inline-flex items-center gap-1 h-7 px-2.5 rounded-[6px] text-[12px] text-[var(--text-3)] border border-[var(--border-faint)] hover:text-[var(--text)] hover:border-[var(--border)] transition-colors cursor-pointer"
        >
          {stripExpanded ? 'Show less' : `+${hiddenCount} more`}
          <svg
            width="9"
            height="9"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ transition: 'transform 150ms ease', transform: stripExpanded ? 'rotate(180deg)' : 'none' }}
          >
            <path d="m4 6 4 4 4-4" />
          </svg>
        </button>
      )}
    </div>
  );
}

/* ----------------------------- tree ----------------------------- */

function TreeBranch({
  nodes,
  level,
  expanded,
  loading,
  childrenByParent,
  selectedId,
  onToggle,
}: {
  nodes: CategoryNode[];
  level: number;
  expanded: Set<string>;
  loading: Set<string>;
  childrenByParent: Map<string, CategoryNode[]>;
  selectedId: string | null;
  onToggle: (n: CategoryNode) => void;
}) {
  return (
    <ul className="list-none p-0 m-0">
      {nodes.map((n) => {
        const isExpanded = expanded.has(n.id);
        const isLoading = loading.has(n.id);
        const kids = childrenByParent.get(n.id);
        const isSelected = selectedId === n.id;
        return (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => onToggle(n)}
              className={`w-full flex items-center gap-1.5 text-left py-1.5 pr-2 text-[12.5px] cursor-pointer transition-colors ${
                isSelected
                  ? 'bg-[var(--brand-soft)] text-[var(--text)]'
                  : 'text-[var(--text-2)] hover:bg-[var(--bg-soft)]'
              }`}
              style={{ paddingLeft: `${10 + level * 14}px` }}
            >
              <span className="w-3 h-3 inline-flex items-center justify-center text-[var(--text-3)] shrink-0">
                {n.isLeaf ? (
                  <span className="w-1 h-1 rounded-full bg-current opacity-60" aria-hidden="true" />
                ) : isLoading ? (
                  <svg
                    width="9"
                    height="9"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="animate-spin"
                    aria-hidden="true"
                  >
                    <path d="M14 8a6 6 0 1 1-4-5.66" />
                  </svg>
                ) : isExpanded ? (
                  <svg
                    width="9"
                    height="9"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m4 6 4 4 4-4" />
                  </svg>
                ) : (
                  <svg
                    width="9"
                    height="9"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m6 4 4 4-4 4" />
                  </svg>
                )}
              </span>
              <span className="truncate">{n.name}</span>
            </button>
            {isExpanded && kids && kids.length > 0 && (
              <TreeBranch
                nodes={kids}
                level={level + 1}
                expanded={expanded}
                loading={loading}
                childrenByParent={childrenByParent}
                selectedId={selectedId}
                onToggle={onToggle}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ----------------------------- detail ----------------------------- */

function NodeDetail({
  node,
  listings,
  pending,
  offset,
  onPage,
  searchQuery,
  onSearchQueryChange,
  onKeywordChange,
  onRunQuery,
  drawerItem,
  onSelectItem,
  onCloseDrawer,
  drawerMockMode = false,
}: {
  node: CategoryNode;
  listings: BrowseSearchResponse | null;
  pending: boolean;
  offset: number;
  onPage: (nextOffset: number) => void;
  searchQuery: SearchQuery;
  onSearchQueryChange: (next: SearchQuery) => void;
  onKeywordChange: (v: string) => void;
  onRunQuery: () => void;
  drawerItem: ItemSummary | null;
  onSelectItem: (item: ItemSummary) => void;
  onCloseDrawer: () => void;
  drawerMockMode?: boolean;
}) {
  const main = (
    <div className="flex flex-col">
      {/* Sticky header — narrow-within input inlined into the filter row
          via SearchFilters' `prefix` slot, so input + Mode/Sort/More
          share one strip. Node name + path live in the status strip
          above the tree (outside this scroll container). */}
      <div className="sticky top-0 z-10 bg-[var(--surface)]">
        <SearchFilters
          value={searchQuery}
          onChange={onSearchQueryChange}
          showCategoryPicker={false}
          prefix={
            <RefineRow
              node={node}
              query={searchQuery.q}
              onQueryChange={onKeywordChange}
              onRunQuery={onRunQuery}
              pending={pending}
            />
          }
        />
      </div>

      <div className="px-5 pt-4 max-sm:px-4">
        {!node.isLeaf && !listings && !pending ? (
          <MetaCategoryPrompt node={node} />
        ) : (
          <SearchResult
            outcome={
              {
                mode: searchQuery.mode,
                body: listings ?? undefined,
                limit: listings?.limit ?? 50,
                offset,
              } satisfies SearchOutcome
            }
            steps={[]}
            pending={pending}
            onPage={onPage}
            onSelectItem={onSelectItem}
            selectedItemId={drawerItem?.itemId ?? null}
          />
        )}
      </div>
    </div>
  );

  return (
    <>
      {main}
      {drawerItem && <RowDrawer item={drawerItem} onClose={onCloseDrawer} mockMode={drawerMockMode} />}
    </>
  );
}

/* ----------------------------- rows ----------------------------- */

/**
 * RefineRow — compact filter strip above the listings inside NodeDetail.
 * Single action: narrow by keyword (Refine). Sized to look like a filter
 * chip so it doesn't claim hero status — the tree is still the primary
 * navigator.
 */
function RefineRow({
  node,
  query,
  onQueryChange,
  onRunQuery,
  pending,
}: {
  node: CategoryNode;
  query: string;
  onQueryChange: (v: string) => void;
  onRunQuery: () => void;
  pending: boolean;
}) {
  const hasQuery = query.trim().length > 0;
  return (
    <div
      className={`flex items-center gap-1.5 h-7 pl-2.5 pr-0.5 rounded-[6px] border transition-colors w-full ${
        hasQuery
          ? 'border-[var(--brand)] bg-[var(--brand-soft)]'
          : 'border-[var(--border-faint)] bg-[var(--surface)] focus-within:border-[var(--border)]'
      }`}
    >
      <svg
        width="11"
        height="11"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={hasQuery ? 'text-[var(--brand)]' : 'text-[var(--text-3)]'}
        aria-hidden="true"
      >
        <circle cx="7" cy="7" r="4.5" />
        <path d="m13 13-2.5-2.5" />
      </svg>
      <input
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !pending) {
            e.preventDefault();
            onRunQuery();
          }
        }}
        placeholder={`Narrow within ${node.name}…`}
        className={`flex-1 min-w-0 bg-transparent outline-none text-[12px] ${
          hasQuery ? 'text-[var(--text)]' : 'text-[var(--text-2)]'
        } placeholder:text-[var(--text-4)]`}
      />
      {hasQuery && (
        <button
          type="button"
          onClick={() => {
            onQueryChange('');
            onRunQuery();
          }}
          title="Clear"
          aria-label="Clear refinement"
          className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-[4px] text-[var(--text-3)] hover:text-[var(--text)] hover:bg-[var(--bg-soft)] transition-colors cursor-pointer"
        >
          <svg
            width="9"
            height="9"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6l-12 12" />
          </svg>
        </button>
      )}
      <button
        type="button"
        onClick={onRunQuery}
        disabled={pending}
        title="Run search"
        aria-label="Run search"
        className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-[4px] bg-[var(--brand)] text-white shadow-[0_1px_2px_rgba(255,77,0,0.25)] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-transform duration-100 active:scale-95"
      >
        {pending ? (
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="animate-spin"
            aria-hidden="true"
          >
            <path d="M21 12a9 9 0 1 1-6.2-8.55" />
          </svg>
        ) : (
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M5 12h14M13 5l7 7-7 7" />
          </svg>
        )}
      </button>
    </div>
  );
}

/**
 * Skeleton rows for the left tree pane while the L1 categories are
 * fetching. Mirrors the chevron + label rhythm of `TreeBranch` rows so
 * the layout doesn't shift when the real tree lands.
 */
/**
 * Right-pane empty state — vertically centered against the right pane's
 * full height, restrained two-icon composition (tree on the left, list
 * on the right, faint arrow between) that visually rhymes "tree → listings".
 * No circles, no brand color, no buttons.
 */
function EmptyPanePrompt({ compact = false }: { compact?: boolean } = {}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-4 px-6 text-center ${
        compact ? 'min-h-[260px] py-10' : 'h-full min-h-[420px]'
      }`}
    >
      <div className="flex items-center gap-3 text-(--text-4)">
        <svg
          width="32"
          height="32"
          viewBox="0 0 32 32"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="6" cy="6" r="1.6" />
          <path d="M6 7.5v18" />
          <path d="M6 14h9" />
          <path d="M6 22h9" />
          <circle cx="18" cy="14" r="1.6" />
          <circle cx="18" cy="22" r="1.6" />
        </svg>
        <svg
          width="20"
          height="14"
          viewBox="0 0 20 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="opacity-60"
        >
          <path d="M2 7h14" />
          <path d="m12 3 4 4-4 4" />
        </svg>
        <svg
          width="32"
          height="32"
          viewBox="0 0 32 32"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="5" y="6" width="22" height="5" rx="1.4" />
          <rect x="5" y="13.5" width="22" height="5" rx="1.4" />
          <rect x="5" y="21" width="22" height="5" rx="1.4" />
        </svg>
      </div>
      <div className="flex flex-col gap-1">
        <p className="m-0 text-[14px] font-medium text-(--text)">Pick a category</p>
        <p className="m-0 text-[12.5px] text-(--text-3) max-w-[300px] leading-relaxed">
          {compact
            ? "Tap a category above to see what's listed there now."
            : "Choose anything in the tree on the left to see what's listed there now."}
        </p>
      </div>
    </div>
  );
}

/**
 * Right pane — selected node is a meta-category (eBay's `/b/<slug>/<id>`
 * landing renders subcategory tiles, not items). Mirrors EmptyPanePrompt's
 * tone but the icon points down-into-tree to suggest "drill in", and the
 * copy names the selected meta cat so the connection to the click is
 * obvious. Sits inside NodeDetail so RefineRow stays visible above —
 * keyword refinement does work on meta cats (SRP keyword path).
 */
function MetaCategoryPrompt({ node }: { node: CategoryNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <svg
        width="32"
        height="32"
        viewBox="0 0 32 32"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-(--text-4)"
        aria-hidden="true"
      >
        <circle cx="6" cy="6" r="1.6" />
        <path d="M6 7.5v18" />
        <path d="M6 14h9" />
        <path d="M6 22h9" />
        <circle cx="13" cy="14" r="1.4" />
        <circle cx="13" cy="22" r="1.4" />
        <path d="M16 14h7" />
        <path d="M16 22h7" />
        <path d="m20 11 3 3-3 3" />
      </svg>
      <div className="flex flex-col gap-1">
        <p className="m-0 text-[14px] font-medium text-(--text)">Drill into a subcategory</p>
        <p className="m-0 text-[12.5px] text-(--text-3) max-w-[320px] leading-relaxed">
          {node.name} groups other categories — pick one from the tree, or refine with a keyword above to search across {node.name}.
        </p>
      </div>
    </div>
  );
}

/** Left tree pane — degenerate "empty" state (server returned 0 nodes
 *  with no error). Practically never hit but kept for symmetry. */
function TreePaneEmpty() {
  return (
    <p className="px-4 py-3 text-[12px] text-(--text-3)">No categories.</p>
  );
}

/**
 * Right pane — surface-level error state, sized to match
 * EmptyPanePrompt so the layout stays stable when categories fail to
 * load. Same visual language: faint icon, primary headline, muted
 * supporting line. Tone tilts slightly toward "alert" via the icon
 * glyph; copy carries the recovery hint.
 */
function PaneError({ message }: { message: string }) {
  return (
    <div className="h-full min-h-[420px] flex flex-col items-center justify-center gap-3 px-6 text-center">
      <svg
        width="32"
        height="32"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-(--text-4)"
        aria-hidden="true"
      >
        <path d="M10.3 3.6 1.6 18a2 2 0 0 0 1.7 3h17.4a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0Z" />
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
      </svg>
      <div className="flex flex-col gap-1">
        <p className="m-0 text-[14px] font-medium text-(--text)">Couldn't load categories</p>
        <p className="m-0 text-[12.5px] text-(--text-3) max-w-[300px] leading-relaxed">{message}</p>
      </div>
    </div>
  );
}

function TreeSkeleton({ stalled = false }: { stalled?: boolean }) {
  // Mixed widths so the placeholder reads as a real category list, not
  // a uniform striped block. Lengths roughly track real eBay L1 names.
  // `stalled` flips the bars to a faint danger tint and freezes the
  // pulse — used when the L1 fetch fails. The right pane carries the
  // explanatory copy; this stays purely visual.
  const widths = [76, 110, 88, 96, 64, 120, 82, 100, 72, 88, 104, 60];
  const dotBg = stalled ? "rgba(185, 28, 28, 0.18)" : "var(--border-faint)";
  const barBg = stalled ? "rgba(185, 28, 28, 0.18)" : "var(--border-faint)";
  const animClass = stalled ? "" : "animate-pulse";
  return (
    <ul className="list-none p-0 m-0" aria-busy={stalled ? undefined : "true"} aria-live="polite">
      {widths.map((w, i) => (
        <li key={i} className="flex items-center gap-1.5 py-1.5 pr-2" style={{ paddingLeft: '10px' }}>
          <span className="w-3 h-3 inline-flex items-center justify-center shrink-0">
            <span
              className={`w-[7px] h-[7px] rounded-[1px] ${animClass}`}
              style={{ background: dotBg }}
            />
          </span>
          <span
            className={`h-[10px] rounded-[3px] ${animClass}`}
            style={{ width: `${w}px`, background: barBg }}
          />
        </li>
      ))}
    </ul>
  );
}

