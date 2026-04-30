/**
 * Per-resource transport capability map + selection logic.
 *
 * Single source of truth for "which transports does each `/v1/*`
 * resource support, and which one should the dispatcher pick at
 * runtime?" Everything that fronts an eBay surface — read or write,
 * REST or scrape or bridge or Trading — declares its capabilities
 * here. Adding a new endpoint = one entry. grep this file to answer
 * "can X be served by bridge?" instantly.
 *
 * `Transport` enumerates the four physical pipes the API can
 * dispatch through. `RESOURCE_TRANSPORTS` is the matrix that says
 * which pipes each resource exposes + what each pipe needs (auth
 * scope, bridge task name, Trading call name). `selectTransport`
 * resolves explicit caller choice → env default → automatic best
 * available, validating capability at every step.
 */

import { BRIDGE_TASKS, type BridgeTask } from "../ebay/bridge/tasks.js";

export type Transport = "rest" | "scrape" | "bridge" | "trading";

interface RestCapability {
	/** "user" = needs connected eBay OAuth; "app" = our app credential; "none" = anonymous reads. */
	needsAuth: "user" | "app" | "none";
	/**
	 * Optional — when set, REST is only available if the named env flag
	 * is `true` in `ctx.envFlags`. Used for Limited Release endpoints
	 * (eBay's Buy Order API and Marketplace Insights need per-tenant
	 * approval; flipagent ships with both 0 and flips them when eBay
	 * grants access). The flag name is opaque to `selectTransport` —
	 * the route layer passes the resolved boolean through.
	 */
	envFlag?: "EBAY_ORDER_API_APPROVED" | "EBAY_INSIGHTS_APPROVED" | "EBAY_CATALOG_APPROVED";
}

interface BridgeCapability {
	taskName: BridgeTask;
}

interface TradingCapability {
	callName: string;
}

export interface ResourceTransports {
	rest?: RestCapability;
	scrape?: true;
	bridge?: BridgeCapability;
	trading?: TradingCapability;
}

/**
 * Capability matrix — every flipagent resource that talks to eBay.
 * Order roughly mirrors `/v1/*` route layout. Future Amazon /
 * Mercari adapters get their own constant tables (separate
 * provider, separate matrix).
 *
 * Keep this list and the route registry in `routes/v1/index.ts`
 * aligned: every entry here corresponds to one or more route
 * handlers; every route that hits eBay should appear here.
 */
export const RESOURCE_TRANSPORTS = {
	// Listings — sourcing
	"listings.search": {
		rest: { needsAuth: "app" },
		scrape: true,
		bridge: { taskName: BRIDGE_TASKS.EBAY_QUERY },
	},
	"listings.sold": {
		// Marketplace Insights REST is Limited Release — gated behind
		// EBAY_INSIGHTS_APPROVED. When unset, scrape transport carries
		// the load (selectTransport auto-picks scrape).
		rest: { needsAuth: "app", envFlag: "EBAY_INSIGHTS_APPROVED" },
		scrape: true,
		bridge: { taskName: BRIDGE_TASKS.EBAY_QUERY },
	},
	"listings.detail": {
		rest: { needsAuth: "app" },
		scrape: true,
		bridge: { taskName: BRIDGE_TASKS.EBAY_QUERY },
	},
	// Buy Order — both transports first-class. REST is the eBay-native
	// path (gated by Limited Release env); bridge drives BIN clicks
	// inside the buyer's real Chrome session. Same `EbayPurchaseOrder`
	// response shape from either transport.
	"orders.checkout": {
		rest: { needsAuth: "user", envFlag: "EBAY_ORDER_API_APPROVED" },
		bridge: { taskName: BRIDGE_TASKS.EBAY_BUY_ITEM },
	},
	// Sell-side REST (require user OAuth)
	"inventory.crud": { rest: { needsAuth: "user" } },
	"fulfillment.read": { rest: { needsAuth: "user" } },
	"fulfillment.ship": { rest: { needsAuth: "user" } },
	"fulfillment.refund": { rest: { needsAuth: "user" } },
	"finance.read": { rest: { needsAuth: "user" } },
	"promotions.crud": { rest: { needsAuth: "user" } },
	"negotiations.outbound": { rest: { needsAuth: "user" } },
	"post-order.cases": { rest: { needsAuth: "user" } },
	"post-order.returns": { rest: { needsAuth: "user" } },
	"analytics.read": { rest: { needsAuth: "user" } },
	"compliance.read": { rest: { needsAuth: "user" } },
	"recommendations.read": { rest: { needsAuth: "user" } },
	"logistics.shipping": { rest: { needsAuth: "user" } },
	"stores.config": { rest: { needsAuth: "user" } },
	// Markets — cross-cutting commerce / metadata
	"markets.policies": { rest: { needsAuth: "user" } },
	"markets.taxonomy": { rest: { needsAuth: "app" } },
	"markets.metadata": { rest: { needsAuth: "user" } },
	// Commerce Catalog REST is a Limited Release surface — most app keys
	// (including ours, today) get `Insufficient permissions` from
	// `/commerce/catalog/v1_beta/...` even with valid credentials. When
	// EBAY_CATALOG_APPROVED is unset we fall through to scrape, which
	// reproduces the documented `Product` shape via /p/{epid} JSON-LD +
	// item-specifics from a representative listing under that EPID.
	"markets.catalog": { rest: { needsAuth: "app", envFlag: "EBAY_CATALOG_APPROVED" }, scrape: true },
	"markets.translation": { rest: { needsAuth: "app" } },
	// Commerce identity
	"identity.user": { rest: { needsAuth: "user" } },
	// Trading XML (fills REST gaps)
	"messages.list": { trading: { callName: "GetMyMessages" } },
	"messages.reply": { trading: { callName: "AddMemberMessageRTQ" } },
	"best-offer.list": { trading: { callName: "GetBestOffers" } },
	"best-offer.respond": { trading: { callName: "RespondToBestOffer" } },
	"feedback.list": { trading: { callName: "GetFeedback" } },
	"feedback.leave": { trading: { callName: "LeaveFeedback" } },
	// Inbox — bridge-only logged-in reads (no eBay API)
	"inbox.watching": { bridge: { taskName: BRIDGE_TASKS.EBAY_INBOX_WATCHING } },
	"inbox.offers": { bridge: { taskName: BRIDGE_TASKS.EBAY_INBOX_OFFERS } },
	"inbox.cases": { bridge: { taskName: BRIDGE_TASKS.EBAY_INBOX_CASES } },
	"inbox.savedSearches": { bridge: { taskName: BRIDGE_TASKS.EBAY_INBOX_SAVED_SEARCHES } },
} as const satisfies Record<string, ResourceTransports>;

export type ResourceKey = keyof typeof RESOURCE_TRANSPORTS;

export interface SelectTransportContext {
	/** Caller-specified transport (`?transport=`). Wins if capable. */
	explicit?: Transport;
	/** Env-driven default (`EBAY_*_SOURCE`). */
	envDefault?: Transport;
	/** Whether this api key has a connected eBay OAuth account. */
	oauthBound?: boolean;
	/** Whether this api key has a paired bridge client (extension). */
	bridgePaired?: boolean;
	/**
	 * Whether this flipagent instance has eBay app credentials
	 * configured (`EBAY_CLIENT_ID` + `EBAY_CLIENT_SECRET`). When false,
	 * REST capabilities with `needsAuth: "app"` are unreachable — auto
	 * falls through to scrape (or throws if no scrape available, e.g.
	 * markets.taxonomy). Self-hosters who run flipagent without
	 * configuring eBay creds should still get a working `/v1/buy/*`
	 * read path via scrape.
	 */
	appCredsConfigured?: boolean;
	/**
	 * Resolved Limited-Release flags from server config. When a
	 * resource's `rest.envFlag` is set, REST is only available if the
	 * named flag here is true.
	 */
	envFlags?: {
		EBAY_ORDER_API_APPROVED?: boolean;
		EBAY_INSIGHTS_APPROVED?: boolean;
		EBAY_CATALOG_APPROVED?: boolean;
	};
}

export class TransportUnavailableError extends Error {
	readonly resource: ResourceKey;
	readonly requested?: Transport;
	constructor(resource: ResourceKey, requested: Transport | undefined, reason: string) {
		super(`transport for ${resource}${requested ? ` (${requested})` : ""}: ${reason}`);
		this.name = "TransportUnavailableError";
		this.resource = resource;
		this.requested = requested;
	}
}

/**
 * Resolve the transport to use for a given resource. Order:
 *   1. Explicit caller choice (validated against capability + auth state)
 *   2. Env default (validated)
 *   3. Auto: prefer cheapest reliable path —
 *        rest(app) → rest(user) when bound → scrape → trading → bridge when paired
 */
export function selectTransport(resource: ResourceKey, ctx: SelectTransportContext = {}): Transport {
	// Widen the literal-narrowed `as const` entry to the union type so
	// optional-field access (`caps.rest`, `caps.scrape`, …) compiles
	// uniformly across resources that have different capability sets.
	const caps = RESOURCE_TRANSPORTS[resource] as ResourceTransports;
	const tryPick = (t: Transport): Transport | null => {
		if (!caps[t]) return null;
		if (t === "rest") {
			if (caps.rest?.needsAuth === "user" && !ctx.oauthBound) return null;
			if (caps.rest?.needsAuth === "app" && ctx.appCredsConfigured === false) return null;
			if (caps.rest?.envFlag && !ctx.envFlags?.[caps.rest.envFlag]) return null;
		}
		if (t === "trading" && !ctx.oauthBound) return null;
		if (t === "bridge" && !ctx.bridgePaired) return null;
		return t;
	};

	if (ctx.explicit) {
		const picked = tryPick(ctx.explicit);
		if (!picked) {
			throw new TransportUnavailableError(
				resource,
				ctx.explicit,
				caps[ctx.explicit] ? "auth/pairing missing" : "not supported by this resource",
			);
		}
		return picked;
	}

	if (ctx.envDefault) {
		const picked = tryPick(ctx.envDefault);
		if (picked) return picked;
		// fall through to auto if env default isn't viable
	}

	// Auto preference order — both rest and bridge are first-class for
	// resources that support both. Default lean: prefer rest when
	// capable (cheaper, no extension needed), otherwise bridge. The
	// caller can flip with explicit ?transport= or env default.
	const restPick = tryPick("rest");
	if (restPick) return restPick;
	if (caps.scrape) return "scrape";
	if (caps.trading && ctx.oauthBound) return "trading";
	if (caps.bridge && ctx.bridgePaired) return "bridge";

	const reasons = [
		!caps.rest && "no rest",
		caps.rest?.needsAuth === "user" && !ctx.oauthBound && "rest needs oauth",
		caps.rest?.needsAuth === "app" && ctx.appCredsConfigured === false && "rest needs ebay app credentials",
		caps.rest?.envFlag && !ctx.envFlags?.[caps.rest.envFlag] && `rest gated by ${caps.rest.envFlag}`,
		!caps.scrape && "no scrape",
		caps.trading && !ctx.oauthBound && "trading needs oauth",
		caps.bridge && !ctx.bridgePaired && "bridge not paired",
	]
		.filter(Boolean)
		.join("; ");
	throw new TransportUnavailableError(resource, undefined, `no available transport (${reasons})`);
}
