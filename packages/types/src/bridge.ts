/**
 * `/v1/bridge/*` schemas — extension client ↔ hosted-API protocol.
 *
 *   POST /v1/bridge/tokens   — issue a long-lived bridge token (auth: api key).
 *                              Plaintext shown once; the bridge client (e.g.
 *                              the flipagent Chrome extension) stores it.
 *   GET  /v1/bridge/poll     — bridge client longpolls for the next claimable
 *                              job for this user. Returns 200 with a job, or
 *                              204 after the longpoll window elapses.
 *   POST /v1/bridge/result   — bridge client reports outcome / progress.
 *
 * The bridge token (`fbt_…`) is distinct from the api key (`fa_…`). It binds
 * one bridge client instance to one api key; revoking the api key cascades.
 */

import { type Static, Type } from "@sinclair/typebox";
import { PurchaseOrderStatus } from "./orders.js";

/* --------------------------- bridge tokens --------------------------- */

export const IssueBridgeTokenRequest = Type.Object(
	{
		deviceName: Type.Optional(Type.String({ maxLength: 200, description: 'Friendly label, e.g. "jinho-macbook".' })),
	},
	{ $id: "IssueBridgeTokenRequest" },
);
export type IssueBridgeTokenRequest = Static<typeof IssueBridgeTokenRequest>;

export const IssueBridgeTokenResponse = Type.Object(
	{
		id: Type.String({ format: "uuid" }),
		token: Type.String({
			description:
				"Plaintext `fbt_…`. Shown once. Store it inside the bridge client (e.g. Chrome extension storage).",
		}),
		prefix: Type.String(),
		createdAt: Type.String({ format: "date-time" }),
	},
	{ $id: "IssueBridgeTokenResponse" },
);
export type IssueBridgeTokenResponse = Static<typeof IssueBridgeTokenResponse>;

/* --------------------------- poll envelope --------------------------- */

/**
 * Generic task identifier. v1 ships `buy_item` (eBay) and `pull_packages`
 * (Planet Express forwarder). New (service, task) pairs plug in by
 * extending the unions and adding a per-service handler in the bridge
 * client. The `service` field carries which adapter to dispatch to.
 *
 * "Service" is broader than "marketplace" — it covers forwarders
 * (Planet Express, MyUS), domestic resale platforms (Naver Smart Store,
 * Coupang), payment processors (in the future), and any other
 * user-session-bound surface flipagent automates against.
 */
export const BridgeJobTask = Type.Union(
	[
		Type.Literal("buy_item"),
		Type.Literal("pull_packages"),
		// Meta task: agent → bridge client `chrome.runtime.reload()`.
		Type.Literal("reload_extension"),
		// Generic browser primitive: query / extract DOM from the active
		// tab. Used by the agent (or higher-level tools) when high-level
		// scrapers fail or to interactively inspect a page during dev.
		Type.Literal("browser_op"),
		// eBay public-data fetch via the user's browser (search / item
		// detail / sold history). Same response shape as Browse REST —
		// the bridge backbone is just a different transport.
		Type.Literal("ebay_query"),
	],
	{ $id: "BridgeJobTask" },
);
export type BridgeJobTask = Static<typeof BridgeJobTask>;

/** Kept named `BridgeMarketplace` for backwards-compat; semantically a service id. */
export const BridgeMarketplace = Type.Union(
	[
		Type.Literal("ebay"),
		Type.Literal("planetexpress"),
		Type.Literal("control"),
		Type.Literal("browser"),
		Type.Literal("ebay_data"),
	],
	{ $id: "BridgeMarketplace" },
);
export type BridgeMarketplace = Static<typeof BridgeMarketplace>;

export const BridgeJob = Type.Object(
	{
		jobId: Type.String({ format: "uuid", description: "Correlates result POST." }),
		task: BridgeJobTask,
		args: Type.Object(
			{
				marketplace: BridgeMarketplace,
				/** Required when `task = "buy_item"`; absent for other tasks. */
				itemId: Type.Optional(Type.String()),
				/** Required when `task = "buy_item"`. */
				quantity: Type.Optional(Type.Integer({ minimum: 1 })),
				/** Optional cap for buy_item — extension fails the job if listing or total exceeds it. */
				maxPriceCents: Type.Optional(Type.Union([Type.Integer(), Type.Null()])),
				/** Free-form per-task hints. PE pull_packages may pass `{ since: ISO }`, etc. */
				metadata: Type.Optional(Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()])),
			},
			{ additionalProperties: false },
		),
		issuedAt: Type.String({ format: "date-time" }),
		expiresAt: Type.String({ format: "date-time" }),
	},
	{ $id: "BridgeJob" },
);
export type BridgeJob = Static<typeof BridgeJob>;

/* ----------------------------- result ----------------------------- */

/**
 * Daemon → API. Reports either an intermediate status transition (claimed,
 * awaiting_user_confirm, placing) or a terminal one (completed, failed).
 */
export const BridgeResultRequest = Type.Object(
	{
		jobId: Type.String({ format: "uuid" }),
		outcome: PurchaseOrderStatus,
		ebayOrderId: Type.Optional(Type.String()),
		totalCents: Type.Optional(Type.Integer({ minimum: 0 })),
		receiptUrl: Type.Optional(Type.String()),
		failureReason: Type.Optional(Type.String({ maxLength: 2000 })),
		/**
		 * Task-specific result payload. For `pull_packages`, the bridge client
		 * reports `{ packages: [...] }`. For `buy_item`, the dedicated fields
		 * above carry receipt info — `result` stays empty.
		 */
		result: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	},
	{ $id: "BridgeResultRequest" },
);
export type BridgeResultRequest = Static<typeof BridgeResultRequest>;

export const BridgeResultResponse = Type.Object({ ok: Type.Literal(true) }, { $id: "BridgeResultResponse" });
export type BridgeResultResponse = Static<typeof BridgeResultResponse>;

/* --------------------------- buyer login state --------------------------- */

/**
 * Snapshot the bridge client POSTs after probing eBay cookies (the Chrome
 * extension does this via `chrome.cookies` on a periodic tick). Surfaced
 * back via `GET /v1/connect/ebay/status` so callers can tell whether the
 * buy-side `/v1/orders/*` flow is actually executable.
 */
export const BridgeLoginStatusRequest = Type.Object(
	{
		loggedIn: Type.Boolean(),
		ebayUserName: Type.Optional(Type.String({ maxLength: 200 })),
	},
	{ $id: "BridgeLoginStatusRequest" },
);
export type BridgeLoginStatusRequest = Static<typeof BridgeLoginStatusRequest>;

export const BridgeLoginStatusResponse = Type.Object({ ok: Type.Literal(true) }, { $id: "BridgeLoginStatusResponse" });
export type BridgeLoginStatusResponse = Static<typeof BridgeLoginStatusResponse>;

/* --------- bridge-client + buyer-session sections of connect status -------- */

/**
 * State of the user's bridge client (today: the flipagent Chrome extension).
 * Surfaced as the `bridgeClient` field on the `/v1/connect/ebay/status` and
 * `/v1/me/ebay/status` responses. Earlier prereleases called this `daemon`
 * (Playwright-driven CLI helper); renamed at the wire level since there are
 * no external consumers yet — only this monorepo's extension + dashboard.
 */
export const ConnectBridgeClientState = Type.Object(
	{
		paired: Type.Boolean(),
		deviceName: Type.Union([Type.String(), Type.Null()]),
		lastSeenAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
	},
	{ $id: "ConnectBridgeClientState" },
);
export type ConnectBridgeClientState = Static<typeof ConnectBridgeClientState>;

export const ConnectBuyerSessionState = Type.Object(
	{
		loggedIn: Type.Boolean(),
		ebayUserName: Type.Union([Type.String(), Type.Null()]),
		verifiedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
	},
	{ $id: "ConnectBuyerSessionState" },
);
export type ConnectBuyerSessionState = Static<typeof ConnectBuyerSessionState>;
