/**
 * Watchlists + deal queue (Overnight pillar on the marketing side).
 *
 *   POST /v1/watchlists           — create
 *   GET  /v1/watchlists           — list
 *   PATCH /v1/watchlists/:id      — update (criteria, cadence, enable/disable)
 *   DELETE /v1/watchlists/:id     — remove
 *   POST  /v1/watchlists/:id/run-now — manual trigger
 *
 *   GET   /v1/queue               — pending deals (paged)
 *   POST  /v1/queue/:id/approve   — mark approved (returns eBay deeplink)
 *   POST  /v1/queue/:id/dismiss   — drop from queue
 */

import { type Static, Type } from "@sinclair/typebox";

export const WatchlistCadence = Type.Union([Type.Literal("hourly"), Type.Literal("every_6h"), Type.Literal("daily")], {
	$id: "WatchlistCadence",
});
export type WatchlistCadence = Static<typeof WatchlistCadence>;

/**
 * Criteria mirror the playground's DiscoverInputs shape. Pinned to a
 * concrete schema so:
 *   1. invalid keys are rejected at create/update time (no silent typos
 *      writing through into the scan worker that would then degrade
 *      to default behaviour),
 *   2. the OpenAPI spec carries field-level docs, and
 *   3. the worker can stop casting the JSONB column to a hand-rolled
 *      interface that drifts from the route validator.
 *
 * Marketplace-specific knobs that future adapters need (Mercari size
 * filters, Poshmark brand-graph) get added here as new optional fields
 * once we have those connectors — the schema is the source of truth.
 */
export const WatchlistCriteria = Type.Object(
	{
		q: Type.String({
			minLength: 1,
			maxLength: 200,
			description: "Search keyword. Required — the watchlist worker rejects empty queries.",
		}),
		categoryId: Type.Optional(
			Type.String({ description: "Pipe-joined Browse category ids, mirrors BrowseSearchQuery.category_ids." }),
		),
		minPriceCents: Type.Optional(Type.Integer({ minimum: 0 })),
		maxPriceCents: Type.Optional(Type.Integer({ minimum: 0 })),
		conditionIds: Type.Optional(
			Type.Array(Type.String({ pattern: "^\\d{3,5}$" }), {
				description: "Browse condition id list, e.g. ['1000','3000']. Each entry must be the numeric enum.",
			}),
		),
		shipsFrom: Type.Optional(Type.String({ description: "ISO-3166 country code filter, e.g. 'US'." })),
		sort: Type.Optional(
			Type.String({
				description: 'Sort key forwarded to the search transport. Common values: "newlyListed", "endingSoonest".',
			}),
		),
		limit: Type.Optional(
			Type.Integer({
				minimum: 1,
				maximum: 50,
				description: "Candidate pool size per scan. Capped at 50 to bound LLM-matcher cost.",
			}),
		),
		minNetCents: Type.Optional(
			Type.Integer({ minimum: 0, description: "Net-margin floor — evaluations below this don't enter the queue." }),
		),
		maxDaysToSell: Type.Optional(
			Type.Integer({ minimum: 1, description: "Reject exits whose expected hold exceeds this window." }),
		),
		outboundShippingCents: Type.Optional(
			Type.Integer({ minimum: 0, description: "Per-comparable outbound shipping in cents. Default: 1000." }),
		),
	},
	{
		$id: "WatchlistCriteria",
		additionalProperties: false,
	},
);
export type WatchlistCriteria = Static<typeof WatchlistCriteria>;

export const Watchlist = Type.Object(
	{
		id: Type.String({ format: "uuid" }),
		name: Type.String(),
		criteria: WatchlistCriteria,
		cadence: WatchlistCadence,
		enabled: Type.Boolean(),
		createdAt: Type.String({ format: "date-time" }),
		updatedAt: Type.String({ format: "date-time" }),
		lastRunAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
		lastRunError: Type.Union([Type.String(), Type.Null()]),
	},
	{ $id: "Watchlist" },
);
export type Watchlist = Static<typeof Watchlist>;

export const WatchlistCreateRequest = Type.Object(
	{
		name: Type.String({ minLength: 1, maxLength: 80 }),
		criteria: WatchlistCriteria,
		cadence: Type.Optional(WatchlistCadence),
	},
	{ $id: "WatchlistCreateRequest" },
);
export type WatchlistCreateRequest = Static<typeof WatchlistCreateRequest>;

export const WatchlistUpdateRequest = Type.Object(
	{
		name: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
		criteria: Type.Optional(WatchlistCriteria),
		cadence: Type.Optional(WatchlistCadence),
		enabled: Type.Optional(Type.Boolean()),
	},
	{ $id: "WatchlistUpdateRequest" },
);
export type WatchlistUpdateRequest = Static<typeof WatchlistUpdateRequest>;

export const WatchlistListResponse = Type.Object(
	{ watchlists: Type.Array(Watchlist) },
	{ $id: "WatchlistListResponse" },
);
export type WatchlistListResponse = Static<typeof WatchlistListResponse>;

export const DealQueueStatus = Type.Union(
	[Type.Literal("pending"), Type.Literal("approved"), Type.Literal("dismissed"), Type.Literal("expired")],
	{ $id: "DealQueueStatus" },
);
export type DealQueueStatus = Static<typeof DealQueueStatus>;

/**
 * One queued deal. Snapshot fields are frozen at scan time so the user
 * acts on the same numbers they were notified about (re-evaluating at
 * approval time would let market drift surprise them).
 */
export const QueuedDeal = Type.Object(
	{
		id: Type.String({ format: "uuid" }),
		watchlistId: Type.String({ format: "uuid" }),
		legacyItemId: Type.String(),
		itemWebUrl: Type.String(),
		status: DealQueueStatus,
		createdAt: Type.String({ format: "date-time" }),
		decidedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
		notifiedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
		// Frozen snapshots — the listing summary as scanned and the
		// evaluation the matcher / evaluator returned at the time. Shapes
		// are opaque here to avoid pinning the schema across versions;
		// callers destructure title / image / recommendedExit as needed.
		itemSnapshot: Type.Record(Type.String(), Type.Unknown()),
		evaluationSnapshot: Type.Record(Type.String(), Type.Unknown()),
	},
	{ $id: "QueuedDeal" },
);
export type QueuedDeal = Static<typeof QueuedDeal>;

export const QueueListResponse = Type.Object({ deals: Type.Array(QueuedDeal) }, { $id: "QueueListResponse" });
export type QueueListResponse = Static<typeof QueueListResponse>;

export const QueueDecisionResponse = Type.Object(
	{
		id: Type.String({ format: "uuid" }),
		status: DealQueueStatus,
		// Approval populates a deeplink so the caller can hand the user
		// straight to eBay's checkout. Until the Buy Order API is wired
		// (Limited Release approval), this is the canonical execution
		// path.
		executeUrl: Type.Optional(Type.String()),
	},
	{ $id: "QueueDecisionResponse" },
);
export type QueueDecisionResponse = Static<typeof QueueDecisionResponse>;
