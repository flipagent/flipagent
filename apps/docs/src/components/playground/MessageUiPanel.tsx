/**
 * Inline panels for assistant-message UI hints (`ui://flipagent/<kind>`).
 *
 * Single source of truth for the "what each tool's UI looks like" layer.
 * Both consumers — the inline chat surface (this file's
 * `<MessageUiPanel>`) and the iframe-mounted MCP-Apps embeds at
 * `/embed/*` — render the SAME panel components, just wire actions to
 * different sinks: inline dispatches a `flipagent-embed-action`
 * CustomEvent so PlaygroundAgent picks it up; iframe posts a message to
 * the parent window.
 *
 * Adding a new panel kind: add a typed `*Props`, write the component,
 * register it in `hasInlinePanel` + the switch in `<MessageUiPanel>`.
 * The iframe surface picks it up automatically by importing the panel.
 */

import type { ItemSummary } from "@flipagent/types/ebay/buy";
import type { ReactElement } from "react";
import { flipagentItemToSummary, type FlipagentItem } from "./api";
import { EvaluateResultBody } from "./EvaluateResult";
import type { EvaluateOutcome } from "./pipelines";
import { SearchResult } from "./SearchResult";
import "./MessageUiPanel.css";

/** MCP-Apps inline UI hint shape. */
export interface UiHint {
	resourceUri: string;
	props?: Record<string, unknown>;
	mimeType?: string;
}

/** Action emitted by row / button clicks inside any panel. The shape
 *  matches the `flipagent-embed-action` CustomEvent contract so a single
 *  upstream handler in PlaygroundAgent serves both inline + iframe
 *  modes. The iframe wrapper just forwards this object via postMessage. */
export type EmbedAction =
	| {
			type: "embed-tool";
			name: string;
			args: Record<string, unknown>;
			label?: string;
			subject?: ActionSubject;
	  }
	| { type: "embed-prompt"; text: string }
	| { type: "embed-link"; url: string };

interface ActionSubject {
	image?: string;
	title?: string;
	subtitle?: string;
	url?: string;
}

type ActionHandler = (a: EmbedAction) => void;

/** Default action sink for inline panels — fires the same CustomEvent
 *  the iframe path used to. PlaygroundAgent listens once globally. */
function dispatchInlineAction(a: EmbedAction): void {
	window.dispatchEvent(new CustomEvent("flipagent-embed-action", { detail: a }));
}

/** True when we have an inline component for this URI. The chat-bubble
 *  caller short-circuits to <ChatIframe> for unknown kinds — keeps
 *  third-party MCP UI working without forcing every URI through here. */
export function hasInlinePanel(resourceUri: string): boolean {
	return (
		resourceUri === "ui://flipagent/search-results" ||
		resourceUri === "ui://flipagent/evaluate" ||
		resourceUri === "ui://flipagent/offers" ||
		resourceUri === "ui://flipagent/listings" ||
		resourceUri === "ui://flipagent/next-action"
	);
}

/* ----------------------------- shapes -------------------------------- */

export interface SearchPanelProps {
	query?: string;
	items?: FlipagentItem[];
	total?: number;
	args?: { limit?: number; offset?: number; [k: string]: unknown };
}

export interface EvaluatePanelProps {
	jobId?: string;
	status?: string;
	outcome?: Partial<EvaluateOutcome>;
	/** When an evaluate run fails in a way that needs user intervention
	 *  (multi-variation listing → must pick a SKU; rate-limited → retry),
	 *  the tool returns these alongside the partial outcome. The panel
	 *  shows a recovery surface instead of the normal hero+chart body. */
	errorCode?: string;
	errorMessage?: string;
	details?: {
		legacyId?: string;
		/** Parent listing's hero image — used as the picker thumbnail
		 *  when individual variations don't expose their own (most
		 *  multi-SKU listings share one parent photo). */
		parentImageUrl?: string;
		/** Parent listing's title — shown above the variant rows so the
		 *  user keeps context on which item they're picking a SKU for. */
		parentTitle?: string;
		variations?: Array<{
			variationId: string;
			priceCents: number | null;
			currency: string;
			aspects: Array<{ name: string; value: string }>;
			/** Per-variation image when eBay exposes one (REST item-group
			 *  response carries it). Falls back to `parentImageUrl`. */
			imageUrl?: string | null;
		}>;
	};
}

type Money = { value: number; currency: string };

export interface OfferRow {
	offerId: string;
	item: {
		itemId?: string;
		title: string;
		url?: string;
		image?: string;
		listPrice: Money;
		condition?: string;
	};
	buyerOffer: Money;
	createdAt?: string;
}

export interface OffersPanelProps {
	offers?: OfferRow[];
}

export interface ListingRow {
	id: string;
	sku: string;
	status: "active" | "draft" | "ended" | "withdrawn" | "sold";
	title: string;
	price: Money;
	quantity: number;
	condition?: string;
	images?: string[];
	url?: string;
	categoryId?: string;
	createdAt?: string;
}

export interface ListingsPanelProps {
	listings?: ListingRow[];
	total?: number;
	args?: { status?: string; limit?: number; offset?: number };
}

export interface NextActionPanelProps {
	error?: string;
	message?: string;
	next_action?: {
		/** "ebay_oauth" | "extension_install" | "rest_or_extension" |
		 *  "forwarder_signin" | "setup_seller_policies" | "configure_ebay" |
		 *  "configure_stripe". String-typed so future kinds render as the
		 *  generic fallback without a code change. */
		kind?: string;
		url?: string;
		instructions?: string;
	};
}

/* ----------------------------- helpers -------------------------------- */

function fmtCentsMoney(m: Money | undefined): string {
	if (!m || m.value == null) return "—";
	const symbol = m.currency === "USD" ? "$" : "";
	return `${symbol}${(m.value / 100).toFixed(2)}`;
}

/* --------------------------- Search results --------------------------- */

const COMPACT_COUNT = new Intl.NumberFormat("en", {
	notation: "compact",
	maximumFractionDigits: 1,
});

function formatCompactCount(n: number): string {
	if (n < 1000) return String(n);
	return COMPACT_COUNT.format(n);
}

/**
 * Build the embed-tool action that fires `flipagent_evaluate_item` for
 * a given row. Used by both row activation and the per-row Evaluate
 * button so the two click targets dispatch identical payloads.
 */
function buildEvaluateAction(item: ItemSummary, args: SearchPanelProps["args"]): EmbedAction {
	void args; // reserved for future "search context"; not on the eval payload yet.
	const priceLabel = item.price?.value ? `$${item.price.value}` : "";
	const subtitle = [priceLabel, item.condition].filter(Boolean).join(" · ");
	return {
		type: "embed-tool",
		name: "flipagent_evaluate_item",
		args: { itemId: item.itemId },
		label: "Evaluate this item",
		subject: {
			...(item.image?.imageUrl ? { image: item.image.imageUrl } : {}),
			...(item.title ? { title: item.title } : {}),
			...(subtitle ? { subtitle } : {}),
			...(item.itemWebUrl ? { url: item.itemWebUrl } : {}),
		},
	};
}

export function SearchResultsPanel({
	props,
	onAction = dispatchInlineAction,
}: {
	props: SearchPanelProps;
	onAction?: ActionHandler;
}) {
	// Pre-result state — set when the agent emits `tool_call_start` and
	// the chat host mounts the panel with an empty `props` placeholder
	// (predictUiResource gave us the right shape; the data lands later).
	// `items === undefined` is the signal: a real empty result set comes
	// back as `items: []`. While pending, render the same skeleton
	// SearchResult uses elsewhere (rows + pager shell), not "0 results".
	const pending = props.items === undefined;
	const itemSummaries: ItemSummary[] = (props.items ?? []).map(flipagentItemToSummary);
	const offset = props.args?.offset ?? 0;
	const limit = props.args?.limit ?? (pending ? 10 : itemSummaries.length);
	const total = props.total;
	const showingTo = offset + itemSummaries.length;
	const eyebrow = pending
		? "Searching listings…"
		: total != null
			? `Showing ${(offset + 1).toLocaleString()}–${showingTo.toLocaleString()} of ${formatCompactCount(total)}`
			: `${itemSummaries.length} ${itemSummaries.length === 1 ? "result" : "results"}`;
	return (
		<div className="msg-ui-panel msg-ui-search">
			<div className="msg-ui-eyebrow">{eyebrow}</div>
			<SearchResult
				outcome={{
					mode: "active",
					body: { itemSummaries, total, offset, limit },
					limit,
					offset,
				}}
				steps={[]}
				pending={pending}
				onPage={(nextOffset) =>
					onAction({
						type: "embed-tool",
						name: "flipagent_search_items",
						args: { ...(props.args ?? {}), offset: nextOffset, limit },
						label: nextOffset > offset ? "Next page of results" : "Previous page of results",
					})
				}
				// Both the row click and the per-row Evaluate button hand off
				// to the agent here. The agent owns evaluation in this
				// panel; falling through to `runEvalForItem` would spin up
				// a parallel pipeline the chat doesn't know about (and
				// would inherit the hero `/signup` redirect for non-fixture
				// itemIds).
				onSelectItem={(item) => onAction(buildEvaluateAction(item, props.args))}
				onEvalItem={(item) => onAction(buildEvaluateAction(item, props.args))}
			/>
		</div>
	);
}

/* ----------------------------- Evaluate ------------------------------ */

export function EvaluatePanel({
	props,
	onAction = dispatchInlineAction,
}: {
	props: EvaluatePanelProps;
	onAction?: ActionHandler;
}) {
	if (props.errorCode === "variation_required" && props.details?.variations?.length) {
		return <EvaluateVariationPicker props={props} onAction={onAction} />;
	}
	if (props.errorCode === "rate_limited" && props.jobId) {
		return <EvaluateRetry props={props} onAction={onAction} />;
	}
	const pending = !props.outcome || (props.status != null && props.status !== "completed");
	const item = props.outcome?.item;
	return (
		<div className="msg-ui-panel msg-ui-eval">
			<div className="msg-ui-eyebrow">{pending ? "Evaluation · running" : "Evaluation"}</div>
			<div className="msg-ui-eval-body pg-result">
				<EvaluateResultBody outcome={props.outcome ?? {}} pending={pending} />
			</div>
			{!pending && item && <EvalActions item={item} onAction={onAction} />}
		</div>
	);
}

function EvaluateVariationPicker({
	props,
	onAction,
}: {
	props: EvaluatePanelProps;
	onAction: ActionHandler;
}) {
	const variations = props.details?.variations ?? [];
	const legacyId = props.details?.legacyId;
	const parentImageUrl = props.details?.parentImageUrl;
	return (
		<div className="msg-ui-panel msg-ui-eval">
			<div className="msg-ui-eyebrow">Pick a variation</div>
			<div className="msg-ui-eval-body">
				<p className="msg-ui-eval-hint">
					This listing has {variations.length} variations. Click one to evaluate that exact SKU.
				</p>
				<ul className="msg-ui-eval-var-list">
					{variations.map((v) => {
						const aspects = v.aspects.map((a) => `${a.name}: ${a.value}`).join(" · ");
						const priceLabel =
							v.priceCents != null ? `$${(v.priceCents / 100).toFixed(2)}` : "—";
						const thumbUrl = v.imageUrl ?? parentImageUrl ?? null;
						return (
							<li key={v.variationId}>
								<button
									type="button"
									className="msg-ui-action msg-ui-eval-var-row"
									onClick={() =>
										onAction({
											type: "embed-tool",
											name: "flipagent_evaluate_item",
											args: {
												itemId: legacyId ? `v1|${legacyId}|${v.variationId}` : v.variationId,
											},
											label: `Evaluate ${aspects || `variation ${v.variationId}`}`,
											subject: {
												...(thumbUrl ? { image: thumbUrl } : {}),
												title: aspects || `Variation ${v.variationId}`,
												subtitle: priceLabel,
											},
										})
									}
								>
									{thumbUrl ? (
										<img className="msg-ui-eval-var-thumb" src={thumbUrl} alt="" loading="lazy" />
									) : (
										<span className="msg-ui-eval-var-thumb msg-ui-eval-var-thumb-empty" aria-hidden="true" />
									)}
									<span className="msg-ui-eval-var-label">
										{aspects || `Variation ${v.variationId}`}
									</span>
									<span className="msg-ui-eval-var-price">{priceLabel}</span>
								</button>
							</li>
						);
					})}
				</ul>
			</div>
		</div>
	);
}

function EvaluateRetry({
	props,
	onAction,
}: {
	props: EvaluatePanelProps;
	onAction: ActionHandler;
}) {
	return (
		<div className="msg-ui-panel msg-ui-eval">
			<div className="msg-ui-eyebrow">Rate-limited</div>
			<div className="msg-ui-eval-body">
				<p className="msg-ui-eval-hint">
					{props.errorMessage ?? "Hit the per-minute API limit before the result came back."}
				</p>
			</div>
			<div className="msg-ui-foot">
				<button
					type="button"
					className="msg-ui-action msg-ui-action-primary"
					onClick={() =>
						onAction({
							type: "embed-tool",
							name: "flipagent_get_evaluate_job",
							args: { jobId: props.jobId },
							label: "Retry the evaluation",
							subject: { title: "Retry evaluation", subtitle: props.jobId },
						})
					}
				>
					Retry
				</button>
			</div>
		</div>
	);
}

function EvalActions({
	item,
	onAction,
}: {
	item: NonNullable<EvaluatePanelProps["outcome"]>["item"];
	onAction: ActionHandler;
}) {
	if (!item) return null;
	const subject = {
		image: item.image?.imageUrl,
		title: item.title,
		subtitle: item.price?.value ? `$${item.price.value}` : undefined,
		url: item.itemWebUrl,
	};
	return (
		<div className="msg-ui-foot">
			<button
				type="button"
				className="msg-ui-action msg-ui-action-primary"
				onClick={() =>
					onAction({
						type: "embed-tool",
						name: "flipagent_create_purchase",
						args: { itemId: item.itemId },
						label: "Buy this item",
						subject,
					})
				}
			>
				Buy this item
			</button>
			<button
				type="button"
				className="msg-ui-action"
				onClick={() =>
					onAction({
						type: "embed-tool",
						name: "flipagent_search_sold_items",
						args: { q: item.title },
						label: "Pull sold comps",
						subject,
					})
				}
			>
				Sold comps
			</button>
			{item.itemWebUrl && (
				<a
					href={item.itemWebUrl}
					target="_blank"
					rel="noopener noreferrer"
					className="msg-ui-action msg-ui-action-link"
				>
					Open on eBay
					<svg
						width="11"
						height="11"
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<path d="M9 3h4v4M13 3 7 9M7 5H4.5A1.5 1.5 0 0 0 3 6.5v5A1.5 1.5 0 0 0 4.5 13h5a1.5 1.5 0 0 0 1.5-1.5V9" />
					</svg>
				</a>
			)}
		</div>
	);
}

/* ------------------------------ Offers ------------------------------- */

export function OffersPanel({
	props,
	onAction = dispatchInlineAction,
}: {
	props: OffersPanelProps;
	onAction?: ActionHandler;
}) {
	const offers = props.offers ?? [];
	if (offers.length === 0) {
		return <div className="msg-ui-panel msg-ui-empty">No pending Best Offers right now.</div>;
	}
	return (
		<div className="msg-ui-panel msg-ui-offers">
			<div className="msg-ui-eyebrow">
				{offers.length} pending {offers.length === 1 ? "offer" : "offers"}
			</div>
			<div className="msg-ui-offers-list">
				{offers.map((o) => (
					<OfferCard key={o.offerId} offer={o} onAction={onAction} />
				))}
			</div>
		</div>
	);
}

function OfferCard({ offer: o, onAction }: { offer: OfferRow; onAction: ActionHandler }) {
	const diffCents = o.item.listPrice.value - o.buyerOffer.value;
	const subjectBase = {
		image: o.item.image,
		title: o.item.title,
		url: o.item.url,
	};
	const respond = (action: "accept" | "counter" | "decline", subtitle: string) =>
		onAction({
			type: "embed-tool",
			name: "flipagent_respond_to_offer",
			args: { id: o.offerId, action },
			label: action === "accept" ? "Accept the offer" : action === "counter" ? "Counter the offer" : "Decline the offer",
			subject: { ...subjectBase, subtitle },
		});

	return (
		<div className="msg-ui-offer-row">
			<a
				href={o.item.url ?? "#"}
				target="_blank"
				rel="noopener noreferrer"
				className="msg-ui-offer-thumb"
			>
				{o.item.image ? (
					<img src={o.item.image} alt="" loading="lazy" />
				) : (
					<div className="msg-ui-offer-thumb-empty" />
				)}
			</a>
			<div className="msg-ui-offer-body">
				<div className="msg-ui-offer-title">{o.item.title}</div>
				<div className="msg-ui-offer-headline">
					Buyer offered <strong>{fmtCentsMoney(o.buyerOffer)}</strong>
					{diffCents > 0 && (
						<span className="msg-ui-offer-headline-diff">
							{" "}
							· {fmtCentsMoney({ value: diffCents, currency: o.item.listPrice.currency })} below your list of{" "}
							{fmtCentsMoney(o.item.listPrice)}
						</span>
					)}
				</div>
				<div className="msg-ui-offer-actions">
					<button
						type="button"
						className="msg-ui-action"
						onClick={() => respond("accept", `Accept @ ${fmtCentsMoney(o.buyerOffer)}`)}
					>
						Accept
					</button>
					<button
						type="button"
						className="msg-ui-action"
						onClick={() => respond("counter", "Counter")}
					>
						Counter
					</button>
					<button
						type="button"
						className="msg-ui-action"
						onClick={() => respond("decline", "Decline")}
					>
						Decline
					</button>
					{o.item.itemId && (
						<button
							type="button"
							className="msg-ui-action msg-ui-action-ghost"
							onClick={() =>
								onAction({
									type: "embed-tool",
									name: "flipagent_evaluate_item",
									args: { itemId: o.item.itemId },
									label: "Evaluate this listing",
									subject: subjectBase,
								})
							}
							title="Pull market comps for this listing"
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
								aria-hidden="true"
							>
								<path d="M3 11a5 5 0 0 1 10 0" />
								<path d="M8 11l2.5-2.5" />
								<circle cx="8" cy="11" r="0.6" fill="currentColor" />
							</svg>
							Evaluate
						</button>
					)}
				</div>
			</div>
		</div>
	);
}

/* ----------------------------- Listings ------------------------------ */

/* My-listings — what I have for sale right now. Different from search:
 * search is "what's on the marketplace", listings is "what I posted".
 * Per-row primary actions are reprice / end / view; "Evaluate" is the
 * same opt-in drill-down we use on offers — pull the current market
 * for that exact listing. */
export function ListingsPanel({
	props,
	onAction = dispatchInlineAction,
}: {
	props: ListingsPanelProps;
	onAction?: ActionHandler;
}) {
	const listings = props.listings ?? [];
	const status = props.args?.status;
	if (listings.length === 0) {
		return (
			<div className="msg-ui-panel msg-ui-empty">
				{status ? `No ${status} listings.` : "No listings yet."}
			</div>
		);
	}
	const eyebrow = status
		? `${listings.length} ${status} listing${listings.length === 1 ? "" : "s"}`
		: `${listings.length} listing${listings.length === 1 ? "" : "s"}`;
	return (
		<div className="msg-ui-panel msg-ui-listings">
			<div className="msg-ui-eyebrow">{eyebrow}</div>
			<div className="msg-ui-listings-list">
				{listings.map((l) => (
					<ListingCard key={l.sku} listing={l} onAction={onAction} />
				))}
			</div>
		</div>
	);
}

function ListingCard({
	listing: l,
	onAction,
}: {
	listing: ListingRow;
	onAction: ActionHandler;
}) {
	const subjectBase = {
		image: l.images?.[0],
		title: l.title,
		url: l.url,
		subtitle: fmtCentsMoney(l.price),
	};
	return (
		<div className="msg-ui-listing-row">
			<a
				href={l.url ?? "#"}
				target="_blank"
				rel="noopener noreferrer"
				className="msg-ui-listing-thumb"
			>
				{l.images?.[0] ? (
					<img src={l.images[0]} alt="" loading="lazy" />
				) : (
					<div className="msg-ui-listing-thumb-empty" />
				)}
			</a>
			<div className="msg-ui-listing-body">
				<div className="msg-ui-listing-title">{l.title}</div>
				<div className="msg-ui-listing-meta">
					<span className={`msg-ui-listing-status msg-ui-listing-status--${l.status}`}>
						{l.status}
					</span>
					<span className="msg-ui-listing-price">{fmtCentsMoney(l.price)}</span>
					{l.quantity > 1 && <span>qty {l.quantity}</span>}
					{l.condition && <span>{l.condition}</span>}
				</div>
				<div className="msg-ui-listing-actions">
					<button
						type="button"
						className="msg-ui-action"
						onClick={() =>
							onAction({
								type: "embed-prompt",
								text: `Reprice ${l.sku} (currently ${fmtCentsMoney(l.price)}) — what should I change it to?`,
							})
						}
					>
						Reprice
					</button>
					{l.status === "active" && (
						<button
							type="button"
							className="msg-ui-action"
							onClick={() =>
								onAction({
									type: "embed-tool",
									name: "flipagent_end_listing",
									args: { sku: l.sku },
									label: "End this listing",
									subject: subjectBase,
								})
							}
						>
							End
						</button>
					)}
					{l.id && (
						<button
							type="button"
							className="msg-ui-action msg-ui-action-ghost"
							onClick={() =>
								onAction({
									type: "embed-tool",
									name: "flipagent_evaluate_item",
									args: { itemId: l.id },
									label: "Evaluate this listing",
									subject: subjectBase,
								})
							}
							title="Pull current market comps for this listing"
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
								aria-hidden="true"
							>
								<path d="M3 11a5 5 0 0 1 10 0" />
								<path d="M8 11l2.5-2.5" />
								<circle cx="8" cy="11" r="0.6" fill="currentColor" />
							</svg>
							Evaluate
						</button>
					)}
				</div>
			</div>
		</div>
	);
}

/* --------------------------- Next Action ----------------------------- */

/**
 * Onboarding / remediation surface — renders when a tool fails with a
 * `next_action` (no eBay account connected, Chrome extension not paired,
 * Planet Express session expired, …). The MCP error handler attaches a
 * UI hint to any tool error that carries `next_action.kind`, so the
 * agent's "you need to do X" reply ships with a clickable card instead
 * of plain instructions.
 *
 * Each kind picks the right verb + transport: OAuth-style flows open
 * the URL (in-app for the dashboard, new tab for external MCP hosts);
 * `setup_seller_policies` re-opens the chat with a guided prompt.
 */
const NEXT_ACTION_PRESENTATION: Record<
	string,
	{ icon: ReactElement; eyebrow: string; title: string; ctaLabel: string }
> = {
	ebay_oauth: {
		icon: <EbayIcon />,
		eyebrow: "Connect your eBay account",
		title: "I need eBay access to do that",
		ctaLabel: "Connect eBay",
	},
	extension_install: {
		icon: <ChromeIcon />,
		eyebrow: "Install the Chrome extension",
		title: "I need the flipagent extension to do that",
		ctaLabel: "Install extension",
	},
	rest_or_extension: {
		icon: <ChromeIcon />,
		eyebrow: "Install the Chrome extension",
		title: "Buying needs the extension paired",
		ctaLabel: "Install extension",
	},
	forwarder_signin: {
		icon: <LinkIcon />,
		eyebrow: "Sign in to Planet Express",
		title: "Your Planet Express session expired",
		ctaLabel: "Sign in to PE",
	},
	setup_seller_policies: {
		icon: <DocIcon />,
		eyebrow: "Set up seller policies",
		title: "Your eBay account is missing return + fulfillment policies",
		ctaLabel: "Set them up now",
	},
	configure_ebay: {
		icon: <GearIcon />,
		eyebrow: "Operator config needed",
		title: "eBay client credentials aren't set on this server",
		ctaLabel: "View health page",
	},
	configure_stripe: {
		icon: <GearIcon />,
		eyebrow: "Operator config needed",
		title: "Stripe credentials aren't set on this server",
		ctaLabel: "View health page",
	},
};

const NEXT_ACTION_FALLBACK = {
	icon: <LinkIcon />,
	eyebrow: "Action needed",
	title: "More info",
	ctaLabel: "Open link",
};

export function NextActionPanel({
	props,
	onAction = dispatchInlineAction,
}: {
	props: NextActionPanelProps;
	onAction?: ActionHandler;
}) {
	const na = props.next_action;
	if (!na?.kind) return null;
	const presentation = NEXT_ACTION_PRESENTATION[na.kind] ?? NEXT_ACTION_FALLBACK;
	const url = na.url;

	const onCta = () => {
		// `setup_seller_policies` is a chat-driven flow (5 questions →
		// flipagent_create_seller_policies). Re-prompt the agent rather
		// than send the user out to a URL.
		if (na.kind === "setup_seller_policies") {
			onAction({
				type: "embed-prompt",
				text: "Set up my eBay seller policies — ask me the 5 quick questions.",
			});
			return;
		}
		if (url) onAction({ type: "embed-link", url });
	};

	return (
		<div className="msg-ui-panel msg-ui-next-action">
			<div className="msg-ui-eyebrow">{presentation.eyebrow}</div>
			<div className="msg-ui-na-body">
				<div className="msg-ui-na-icon" aria-hidden="true">
					{presentation.icon}
				</div>
				<div>
					<div className="msg-ui-na-title">{presentation.title}</div>
					{(props.message || na.instructions) && (
						<p className="msg-ui-na-detail">{props.message ?? na.instructions}</p>
					)}
				</div>
			</div>
			<div className="msg-ui-foot">
				<button type="button" className="msg-ui-action msg-ui-action-primary" onClick={onCta}>
					{presentation.ctaLabel}
				</button>
				{url && na.kind !== "setup_seller_policies" && (
					<a
						href={url}
						target="_blank"
						rel="noopener noreferrer"
						className="msg-ui-action msg-ui-action-ghost"
					>
						Open in new tab
					</a>
				)}
			</div>
		</div>
	);
}

function EbayIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
			<rect x="2" y="4" width="12" height="8" rx="1.5" />
			<path d="M2 7h12" />
		</svg>
	);
}

function ChromeIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
			<circle cx="8" cy="8" r="6" />
			<circle cx="8" cy="8" r="2.2" />
			<path d="M8 6 L13.5 6 M5.9 9.1 L3.2 13.6 M10.1 9.1 L12.8 13.6" />
		</svg>
	);
}

function LinkIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
			<path d="M9 3h4v4M13 3 7 9M7 5H4.5A1.5 1.5 0 0 0 3 6.5v5A1.5 1.5 0 0 0 4.5 13h5a1.5 1.5 0 0 0 1.5-1.5V9" />
		</svg>
	);
}

function DocIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
			<path d="M4 2.5h5L12 5.5V13a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 4 13z" />
			<path d="M9 2.5V6h3M6 8h4M6 10.5h4" />
		</svg>
	);
}

function GearIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
			<circle cx="8" cy="8" r="2" />
			<path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8L3.4 3.4" />
		</svg>
	);
}

/* ----------------------------- Dispatcher ----------------------------- */

/**
 * Switches on `ui.resourceUri` to render the right inline panel. Returns
 * `null` for unknown URIs — the caller falls back to whatever generic
 * surface it has (the iframe `<ChatIframe>`, a typing dot, etc.).
 */
export function MessageUiPanel({ ui }: { ui: UiHint }): ReactElement | null {
	const props = (ui.props ?? {}) as Record<string, unknown>;
	switch (ui.resourceUri) {
		case "ui://flipagent/search-results":
			return <SearchResultsPanel props={props as SearchPanelProps} />;
		case "ui://flipagent/evaluate":
			return <EvaluatePanel props={props as EvaluatePanelProps} />;
		case "ui://flipagent/offers":
			return <OffersPanel props={props as OffersPanelProps} />;
		case "ui://flipagent/listings":
			return <ListingsPanel props={props as ListingsPanelProps} />;
		case "ui://flipagent/next-action":
			return <NextActionPanel props={props as NextActionPanelProps} />;
		default:
			return null;
	}
}
