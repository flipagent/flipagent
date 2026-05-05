/**
 * `/v1/capabilities` — agent's first-call discovery surface. Tells the
 * agent which marketplaces are reachable and at which fidelity:
 *
 *   ok                  — the call works for this api key right now.
 *   needs_signin        — backed by the bridge client (Chrome extension)
 *                         but the user isn't signed into the marketplace
 *                         in their browser yet.
 *   needs_oauth         — needs the user's seller OAuth handshake
 *                         (`/v1/connect/{marketplace}`).
 *   approval_pending    — the underlying marketplace API is gated and
 *                         we're waiting on tenant approval (e.g. eBay
 *                         Order API, Marketplace Insights).
 *   scrape               — served by the scrape transport. Either REST
 *                         isn't approved/wired for this resource (key
 *                         tier or upstream gated) or the resource is
 *                         scrape-only by design. Scrape is a 1st-class
 *                         transport in flipagent, equal to REST and
 *                         bridge — the status reports the data path,
 *                         not a degradation.
 *   unavailable         — the host instance hasn't been configured for
 *                         this capability (env vars unset).
 *
 * Agents should call this once at session start and decide which
 * tools to attempt. `client.extensionPaired` controls whether buy-side
 * is even possible for this api key.
 */

import { type Static, Type } from "@sinclair/typebox";

export const CapabilityStatus = Type.Union(
	[
		Type.Literal("ok"),
		Type.Literal("needs_signin"),
		Type.Literal("needs_oauth"),
		Type.Literal("approval_pending"),
		Type.Literal("scrape"),
		Type.Literal("unavailable"),
	],
	{ $id: "CapabilityStatus" },
);
export type CapabilityStatus = Static<typeof CapabilityStatus>;

export const MarketplaceId = Type.Union([Type.Literal("ebay")], { $id: "MarketplaceId" });
export type MarketplaceId = Static<typeof MarketplaceId>;

export const ForwarderId = Type.Union([Type.Literal("planetexpress")], { $id: "ForwarderId" });
export type ForwarderId = Static<typeof ForwarderId>;

export const MarketplaceCapabilities = Type.Object(
	{
		/** Active-listing search (`/v1/items/search`). */
		search: CapabilityStatus,
		/** Sold-listing search (`/v1/items/search?status=sold`). For eBay, scrape transport when Marketplace Insights REST unapproved. */
		sold: CapabilityStatus,
		/** Single-listing detail (`/v1/items/{id}`). */
		detail: CapabilityStatus,
		/** Score one listing (`/v1/evaluate`). */
		evaluate: CapabilityStatus,
		/** Buyer-side checkout (`/v1/purchases`). REST or bridge transport. */
		buy: CapabilityStatus,
		/** Sell-side ops (`/v1/listings`, `/v1/sales`, `/v1/payouts`, `/v1/policies`, …). Requires seller OAuth. */
		sell: CapabilityStatus,
	},
	{ $id: "MarketplaceCapabilities" },
);
export type MarketplaceCapabilities = Static<typeof MarketplaceCapabilities>;

/**
 * Forwarder capabilities — Planet Express, MyUS, Stackry, etc. Most have
 * no public API; flipagent reads via the user's logged-in session through
 * the Chrome extension. Auto-actions (read packages) are safe; money
 * commits (ship-to-destination $30~100) are interactive (user clicks).
 */
export const ForwarderCapabilities = Type.Object(
	{
		/** List incoming + on-hand packages. Requires bridge client + user signed in to forwarder. */
		packages: CapabilityStatus,
		/** Request consolidate (small fee, mostly automatic). */
		consolidate: CapabilityStatus,
		/** Ship to destination (real money — interactive only). */
		ship: CapabilityStatus,
	},
	{ $id: "ForwarderCapabilities" },
);
export type ForwarderCapabilities = Static<typeof ForwarderCapabilities>;

/**
 * Setup hints — env-aware install instructions for the bridge extension
 * + dashboard. Surfaced when capabilities flag the extension as
 * unpaired so the agent can hand the user the right install path
 * without asking. `mode = "hosted"` when the api is running on
 * api.flipagent.dev, `"self-hosted"` for any other base.
 */
export const SetupHints = Type.Object(
	{
		mode: Type.Union([Type.Literal("hosted"), Type.Literal("self-hosted")]),
		apiBase: Type.String(),
		extensionInstall: Type.Object({
			from: Type.Union([Type.Literal("chrome-web-store"), Type.Literal("unpacked-dev-build")]),
			url: Type.Optional(Type.String({ description: "Web Store URL when mode=hosted." })),
			devBuildSteps: Type.Optional(
				Type.Array(Type.String({ description: "Shell commands when mode=self-hosted." })),
			),
		}),
		dashboardUrl: Type.String({ description: "Where the user manages keys / OAuth / billing." }),
		/**
		 * Signup URLs for forwarders the agent might point a fresh user
		 * at (no PE account yet). Operator-configured: when the api has
		 * a referral code (`PLANET_EXPRESS_REFERRAL_CODE`), this URL
		 * carries it so the new account attributes back to the
		 * operator. Empty referral falls back to the unbranded `/signup`.
		 */
		forwarderSignup: Type.Object({
			planetexpress: Type.String({ format: "uri" }),
		}),
	},
	{ $id: "SetupHints" },
);
export type SetupHints = Static<typeof SetupHints>;

/**
 * Setup checklist — server-derived, single source of truth for the
 * onboarding flow shown by every flipagent surface (popup, dashboard,
 * MCP / agent prompts). Each step has the same shape so consumers can
 * render uniformly without per-surface logic.
 *
 * Rules:
 *   - `done` → step satisfied. Render dimmed.
 *   - `active` → step is the user's current actionable item. Render
 *     prominent with the CTA.
 *   - `locked` → prerequisite step (e.g. pair_extension) blocks this
 *     one. Render dim + disabled.
 *   - `nextStep` is the id of the highest-priority `active` step
 *     (the one the surface should highlight first). Null when every
 *     required step is `done`.
 *   - `required: true` steps belong to the canonical resell loop
 *     (sell + buy via bridge). Optional steps (e.g. forwarder) only
 *     gate specific workflows and should be tagged that way in UI.
 */
export const SetupStepId = Type.Union(
	[Type.Literal("pair_extension"), Type.Literal("ebay_signin"), Type.Literal("seller_oauth")],
	{ $id: "SetupStepId" },
);
export type SetupStepId = Static<typeof SetupStepId>;

export const SetupStepStatus = Type.Union([Type.Literal("done"), Type.Literal("active"), Type.Literal("locked")], {
	$id: "SetupStepStatus",
});
export type SetupStepStatus = Static<typeof SetupStepStatus>;

export const SetupStep = Type.Object(
	{
		id: SetupStepId,
		status: SetupStepStatus,
		/** True for steps in the canonical resell loop (sell + buy via bridge). False for optional steps that only gate specific workflows. */
		required: Type.Boolean(),
		title: Type.String(),
		description: Type.String(),
		/** Capability surfaces this step gates — e.g. ['buy'] for ebay_signin, ['sell'] for seller_oauth, ['forwarder'] for planetexpress. */
		unlocks: Type.Array(Type.String()),
	},
	{ $id: "SetupStep" },
);
export type SetupStep = Static<typeof SetupStep>;

export const SetupChecklist = Type.Object(
	{
		steps: Type.Array(SetupStep),
		/** Highest-priority `active` step id, or null when every required step is `done`. */
		nextStep: Type.Union([SetupStepId, Type.Null()]),
		allRequiredDone: Type.Boolean(),
	},
	{ $id: "SetupChecklist" },
);
export type SetupChecklist = Static<typeof SetupChecklist>;

export const CapabilitiesResponse = Type.Object(
	{
		client: Type.Object({
			extensionPaired: Type.Boolean(),
			deviceName: Type.Union([Type.String(), Type.Null()]),
			lastSeenAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
		}),
		marketplaces: Type.Object({
			ebay: MarketplaceCapabilities,
		}),
		forwarders: Type.Object({
			planetexpress: ForwarderCapabilities,
		}),
		setup: SetupHints,
		checklist: SetupChecklist,
		generatedAt: Type.String({ format: "date-time" }),
	},
	{ $id: "CapabilitiesResponse" },
);
export type CapabilitiesResponse = Static<typeof CapabilitiesResponse>;
