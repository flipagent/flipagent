/**
 * Inline UI for `flipagent_search_items` — rendered inside an iframe
 * by the chat host (or any MCP Apps-compatible client). Contract:
 *
 *   1. iframe loads → posts `{ type: 'embed-ready' }` to parent
 *   2. host responds with `{ type: 'embed-init', data: { query, items, total, … } }`
 *   3. iframe renders the list
 *   4. user clicks an item → posts `{ type: 'embed-tool', name: 'flipagent_evaluate_item',
 *      args: { itemId } }` so the host can drive the next agent turn
 *
 * Stays inside the docs origin so global.css tokens, fonts, and auth
 * cookies all carry over from the parent page — no token bridge needed.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import "./Embed.css";

interface Money {
	value: number;
	currency: string;
}

interface Item {
	id: string;
	title: string;
	url: string;
	price?: Money;
	soldPrice?: Money;
	condition?: string;
	images?: string[];
	shipping?: { cost?: Money; free?: boolean };
	bidding?: { count?: number; currentBid?: Money };
	seller?: { username?: string; feedbackPercentage?: string };
}

interface InitPayload {
	query?: string;
	items?: Item[];
	total?: number;
	source?: string;
	/** Echo of the original tool call args; used to bump `offset` for
	 *  "load more" requests sent back to the agent host. */
	args?: {
		q?: string;
		limit?: number;
		offset?: number;
		sort?: string;
		marketplace?: string;
		[key: string]: unknown;
	};
}

function formatMoney(money: Money | undefined): string {
	if (!money || money.value == null) return "";
	const symbol = money.currency === "USD" ? "$" : "";
	return `${symbol}${(money.value / 100).toFixed(2)}`;
}

function postToHost(msg: Record<string, unknown>) {
	window.parent.postMessage({ ...msg, source: "flipagent-embed" }, "*");
}

function reportSize() {
	const h = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0);
	postToHost({ type: "embed-resize", height: h });
}

const PAGE_SIZE = 10;

export function EmbedSearchResults() {
	const [data, setData] = useState<InitPayload | null>(null);
	const [page, setPage] = useState(0);
	const rootRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		function onMessage(e: MessageEvent) {
			const m = e.data as { source?: string; type?: string; data?: InitPayload } | null;
			if (!m || typeof m !== "object") return;
			if (m.type === "embed-init" && m.data) {
				setData(m.data);
				setPage(0);
			}
		}
		window.addEventListener("message", onMessage);
		// Announce ready so the host sends init.
		postToHost({ type: "embed-ready", kind: "search-results" });
		return () => window.removeEventListener("message", onMessage);
	}, []);

	// Resize observer — keep the host iframe height in sync with content.
	useEffect(() => {
		const el = rootRef.current;
		if (!el) return;
		const obs = new ResizeObserver(() => reportSize());
		obs.observe(el);
		reportSize();
		return () => obs.disconnect();
	}, []);

	const items = useMemo(() => data?.items ?? [], [data]);
	const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
	const pageItems = useMemo(
		() => items.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
		[items, page],
	);

	if (!data || !data.items) {
		return (
			<div ref={rootRef} className="embed-card embed-skeleton">
				<header className="embed-card-header">
					<div className="embed-card-title">
						<span className="embed-card-kicker">Search</span>
						<span className="skel skel-bar" style={{ width: 120 }} />
					</div>
					<span className="skel skel-bar" style={{ width: 64, height: 10 }} />
				</header>
				<ul className="embed-list">
					{Array.from({ length: 5 }).map((_, i) => (
						<li key={i} className="embed-item">
							<span className="skel skel-thumb" />
							<div className="embed-item-body">
								<span className="skel skel-bar" style={{ width: "78%", height: 13 }} />
								<div className="embed-item-meta">
									<span className="skel skel-bar" style={{ width: 56, height: 11 }} />
									<span className="skel skel-bar" style={{ width: 72, height: 11 }} />
									<span className="skel skel-bar" style={{ width: 48, height: 11 }} />
								</div>
							</div>
							<span className="skel skel-pill" style={{ width: 60 }} />
						</li>
					))}
				</ul>
			</div>
		);
	}

	const headerCount =
		data.total != null && data.total > items.length ? `${items.length} of ${data.total}` : `${items.length}`;
	const start = page * PAGE_SIZE + 1;
	const end = Math.min(items.length, page * PAGE_SIZE + PAGE_SIZE);

	return (
		<div ref={rootRef} className="embed-card">
			<header className="embed-card-header">
				<div className="embed-card-title">
					<span className="embed-card-kicker">Search</span>
					<span className="embed-card-q">{data.query ? `"${data.query}"` : "(no query)"}</span>
				</div>
				<span className="embed-card-count">{headerCount} listings</span>
			</header>
			{items.length === 0 ? (
				<div className="embed-empty">No active listings matched.</div>
			) : (
				<ul className="embed-list">
					{pageItems.map((it) => {
						const thumb = it.images?.[0];
						return (
							<li key={it.id} className="embed-item">
								<a
									href={it.url}
									target="_blank"
									rel="noopener noreferrer"
									className="embed-thumb-wrap"
									onClick={(e) => {
										e.preventDefault();
										postToHost({ type: "embed-link", url: it.url });
									}}
								>
									{thumb ? (
										<img src={thumb} alt="" className="embed-thumb" loading="lazy" />
									) : (
										<div className="embed-thumb-placeholder" />
									)}
								</a>
								<div className="embed-item-body">
									<a
										href={it.url}
										target="_blank"
										rel="noopener noreferrer"
										className="embed-item-title"
										onClick={(e) => {
											e.preventDefault();
											postToHost({ type: "embed-link", url: it.url });
										}}
									>
										{it.title}
									</a>
									<div className="embed-item-meta">
										{it.price && <span className="embed-price">{formatMoney(it.price)}</span>}
										{it.condition && <span className="embed-condition">{it.condition}</span>}
										{it.shipping?.free ? (
											<span className="embed-ship">free ship</span>
										) : it.shipping?.cost ? (
											<span className="embed-ship">+{formatMoney(it.shipping.cost)} ship</span>
										) : null}
										{it.bidding?.count != null && <span className="embed-bids">{it.bidding.count} bids</span>}
										{it.seller?.feedbackPercentage && (
											<span className="embed-seller">{it.seller.feedbackPercentage}% seller</span>
										)}
									</div>
								</div>
								<button
									type="button"
									className="embed-action"
									onClick={() => {
										const priceStr = formatMoney(it.price);
										const subtitleParts = [
											priceStr,
											it.condition,
											it.shipping?.free
												? "free ship"
												: it.shipping?.cost
													? `+${formatMoney(it.shipping.cost)} ship`
													: undefined,
										].filter(Boolean) as string[];
										postToHost({
											type: "embed-tool",
											name: "flipagent_evaluate_item",
											args: { itemId: it.id },
											label: "Evaluate this item",
											subject: {
												image: thumb,
												title: it.title,
												subtitle: subtitleParts.join(" · "),
												url: it.url,
											},
										});
									}}
								>
									Evaluate
								</button>
							</li>
						);
					})}
				</ul>
			)}
			{(() => {
				const isLastClientPage = page >= pageCount - 1;
				// More results exist on the server if the upstream `total` is
				// larger than what we've already fetched (offset + items.len)
				// — accept both the stored arg offset and a default of 0.
				const fetchedOffset = (data.args?.offset as number | undefined) ?? 0;
				const fetchedSoFar = fetchedOffset + items.length;
				const hasMoreOnServer = data.total != null && data.total > fetchedSoFar;
				const showFooter = items.length > PAGE_SIZE || hasMoreOnServer;
				if (!showFooter) return null;
				const requestNextBatch = () => {
					const limit = (data.args?.limit as number | undefined) ?? PAGE_SIZE;
					const args: Record<string, unknown> = {
						q: data.query ?? data.args?.q ?? "",
						offset: fetchedSoFar,
						limit,
					};
					if (data.args?.sort) args.sort = data.args.sort;
					if (data.args?.marketplace) args.marketplace = data.args.marketplace;
					postToHost({
						type: "embed-tool",
						name: "flipagent_search_items",
						args,
						label: `Load more "${data.query ?? ""}" listings`,
						// No `subject` — there's no item to preview here, just
						// a continuation of the existing search. Host will
						// render this as a plain user bubble with a small
						// action icon (no full card panel).
					});
				};
				return (
					<footer className="embed-card-footer">
						<span className="embed-card-range">
							{start}–{end} of {data.total != null ? data.total : items.length}
						</span>
						<div className="embed-pager">
							<button
								type="button"
								className="embed-pager-btn"
								disabled={page === 0}
								onClick={() => setPage((p) => Math.max(0, p - 1))}
								aria-label="Previous page"
							>
								‹
							</button>
							<span className="embed-pager-pos">
								{page + 1} / {pageCount}
								{hasMoreOnServer ? "+" : ""}
							</span>
							{isLastClientPage && hasMoreOnServer ? (
								<button
									type="button"
									className="embed-pager-btn embed-pager-load"
									onClick={requestNextBatch}
									aria-label="Load more"
									title="Fetch the next page from the server"
								>
									Load more ›
								</button>
							) : (
								<button
									type="button"
									className="embed-pager-btn"
									disabled={isLastClientPage}
									onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
									aria-label="Next page"
								>
									›
								</button>
							)}
						</div>
					</footer>
				);
			})()}
		</div>
	);
}
