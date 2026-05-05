/**
 * Computes the capability map served by `GET /v1/capabilities`. Pulls
 * together: bridge-token presence, eBay seller OAuth row, env-driven
 * eBay tenant approvals, and scrape-proxy availability.
 *
 * As we add Amazon / Mercari, each gets its own block here. The shape
 * of `MarketplaceCapabilities` per marketplace is identical so the
 * agent's tool-selection logic stays uniform.
 */

import type {
	CapabilitiesResponse,
	CapabilityStatus,
	ForwarderCapabilities,
	MarketplaceCapabilities,
	SetupChecklist,
	SetupHints,
	SetupStep,
	SetupStepId,
} from "@flipagent/types";
import { and, desc, eq, isNull } from "drizzle-orm";
import { config, isEbayOAuthConfigured, isInsightsApproved, isScraperApiConfigured } from "../config.js";
import { db } from "../db/client.js";
import { bridgeTokens, userEbayOauth } from "../db/schema.js";
import { planetExpressSignupUrl } from "./shared/forwarder.js";

/**
 * Setup hints — what install path the agent should hand the user. Hosted
 * mode points at the Chrome Web Store + flipagent.dev dashboard;
 * self-hosted mode prints the unpacked-build commands + the operator's
 * own dashboard origin so the agent can guide a local-dev or
 * self-host operator without asking.
 *
 * "Hosted" is detected by `BETTER_AUTH_URL` matching the canonical
 * production host. Anything else (localhost, custom domain, dev
 * environment) is treated as self-hosted.
 */
function computeSetupHints(): SetupHints {
	const apiBase = config.BETTER_AUTH_URL.replace(/\/+$/, "");
	const dashboard = config.APP_URL.replace(/\/+$/, "");
	const hosted = apiBase === "https://api.flipagent.dev";
	const forwarderSignup = { planetexpress: planetExpressSignupUrl() };
	if (hosted) {
		return {
			mode: "hosted",
			apiBase,
			dashboardUrl: dashboard,
			extensionInstall: {
				from: "chrome-web-store",
				url: "https://chrome.google.com/webstore/detail/aimmkefiblmcjppnancgfejmbpcfnddf",
			},
			forwarderSignup,
		};
	}
	return {
		mode: "self-hosted",
		apiBase,
		dashboardUrl: dashboard,
		extensionInstall: {
			from: "unpacked-dev-build",
			devBuildSteps: [
				`FLIPAGENT_API_BASE=${apiBase} FLIPAGENT_DASHBOARD_BASE=${dashboard} npm run build:dev --workspace @flipagent/extension`,
				"Open chrome://extensions/ → enable Developer mode → Load unpacked → select packages/extension/dist",
				"Click the flipagent extension icon → enter your flipagent API key to pair (or open the dashboard above and pair from there)",
			],
		},
		forwarderSignup,
	};
}

export async function computeCapabilities(apiKeyId: string): Promise<CapabilitiesResponse> {
	const [bridgeRows, oauthRows] = await Promise.all([
		db
			.select({
				deviceName: bridgeTokens.deviceName,
				lastSeenAt: bridgeTokens.lastSeenAt,
				ebayLoggedIn: bridgeTokens.ebayLoggedIn,
			})
			.from(bridgeTokens)
			.where(and(eq(bridgeTokens.apiKeyId, apiKeyId), isNull(bridgeTokens.revokedAt)))
			.orderBy(desc(bridgeTokens.createdAt))
			.limit(1),
		db.select({ id: userEbayOauth.id }).from(userEbayOauth).where(eq(userEbayOauth.apiKeyId, apiKeyId)).limit(1),
	]);

	const bridge = bridgeRows[0];
	const sellerConnected = oauthRows.length > 0;

	const ebay = ebayCapabilities({
		extensionPaired: !!bridge,
		ebayLoggedIn: !!bridge?.ebayLoggedIn,
		sellerConnected,
	});
	const planetexpress = planetExpressCapabilities({ extensionPaired: !!bridge });

	const checklist = computeSetupChecklist({
		extensionPaired: !!bridge,
		ebayLoggedIn: !!bridge?.ebayLoggedIn,
		sellerConnected,
	});

	return {
		client: {
			extensionPaired: !!bridge,
			deviceName: bridge?.deviceName ?? null,
			lastSeenAt: bridge?.lastSeenAt ? bridge.lastSeenAt.toISOString() : null,
		},
		marketplaces: { ebay },
		forwarders: { planetexpress },
		setup: computeSetupHints(),
		checklist,
		generatedAt: new Date().toISOString(),
	};
}

/**
 * Build the onboarding checklist from the same primitive signals the
 * capability matrix derives from. One server-side derivation, consumed
 * identically by popup, dashboard, and MCP — agents and humans see the
 * same step labels in the same order.
 *
 * Forwarder login (Planet Express) deliberately NOT in the checklist:
 * it's a session-bound state that expires within ~30 min of idle and
 * lives in the user's browser localStorage (PE doesn't ship cookies),
 * so framing it as "setup" misleads. The ship-time path nudges the
 * user to re-sign-in on demand instead — see content.ts handler that
 * emits `planetexpress_signed_out` when a job lands on the sign-in page.
 */
function computeSetupChecklist(input: {
	extensionPaired: boolean;
	ebayLoggedIn: boolean;
	sellerConnected: boolean;
}): SetupChecklist {
	const pair: SetupStep = {
		id: "pair_extension",
		status: input.extensionPaired ? "done" : "active",
		required: true,
		title: "Pair this Chrome",
		description:
			"Paste a flipagent API key in the extension popup, or sign in via the dashboard. Required for buying via bridge and any browser-driven workflow.",
		unlocks: ["buy", "bridge", "forwarder"],
	};
	const ebaySignin: SetupStep = {
		id: "ebay_signin",
		status: !input.extensionPaired ? "locked" : input.ebayLoggedIn ? "done" : "active",
		required: true,
		title: "Sign in to eBay",
		description:
			"Sign in to ebay.com in this Chrome. flipagent reads the existing session — no password ever leaves your browser.",
		unlocks: ["buy"],
	};
	const sellerOauth: SetupStep = {
		id: "seller_oauth",
		status: input.sellerConnected ? "done" : "active",
		required: true,
		title: "Connect seller account",
		description:
			"OAuth handshake on the dashboard. Required to list, ship, manage offers, payouts, disputes — all sell-side REST.",
		unlocks: ["sell"],
	};
	const steps = [pair, ebaySignin, sellerOauth];
	const nextActive = steps.find((s) => s.status === "active") ?? null;
	const allRequiredDone = steps.filter((s) => s.required).every((s) => s.status === "done");
	return {
		steps,
		nextStep: (nextActive?.id ?? null) as SetupStepId | null,
		allRequiredDone,
	};
}

interface EbayInputs {
	extensionPaired: boolean;
	ebayLoggedIn: boolean;
	sellerConnected: boolean;
}

function ebayCapabilities(input: EbayInputs): MarketplaceCapabilities {
	// Search / detail / sold are picked per-route by env: `rest` (Browse
	// REST, requires `EBAY_CLIENT_ID`), `scrape` (managed scraping vendor,
	// requires `SCRAPER_API_USERNAME/PASSWORD`), or `bridge` (extension,
	// requires the caller's extension to be paired). Capability surface
	// reports `ok` when *any* primitive is available; the actual route
	// picks one based on its own env.
	const anySource = isEbayOAuthConfigured() || isScraperApiConfigured() || input.extensionPaired;
	const search: CapabilityStatus = anySource ? "ok" : "unavailable";
	const detail: CapabilityStatus = search;
	const sold: CapabilityStatus =
		isInsightsApproved() || isScraperApiConfigured() || input.extensionPaired ? "ok" : "unavailable";

	// Evaluate: pure server-side scoring; works whenever the api can
	// fetch sold + active. Requires the api key tier to allow it
	// (rate-limit is enforced upstream, not here).
	const evaluate: CapabilityStatus = "ok";

	// Buy-side: needs bridge client paired AND user signed into eBay
	// in their browser. Order API approval (`EBAY_ORDER_APPROVED`)
	// is the alternative path that doesn't need the extension.
	const buy: CapabilityStatus = config.EBAY_ORDER_APPROVED
		? "ok"
		: !input.extensionPaired
			? "unavailable"
			: input.ebayLoggedIn
				? "ok"
				: "needs_signin";

	// Sell-side: passthrough requires the user's seller OAuth tokens.
	const sell: CapabilityStatus = input.sellerConnected ? "ok" : "needs_oauth";

	return { search, sold, detail, evaluate, buy, sell };
}

/**
 * Planet Express has no public API; everything goes through the user's
 * logged-in session via the Chrome extension. We don't track buyer-login
 * state per-forwarder yet — `needs_signin` would require a PE-specific
 * cookie/DOM probe in the content script. v1 reports `ok` whenever the
 * extension is paired and lets the actual call surface a real-time
 * "please sign in to planetexpress.com" if cookies are missing.
 */
function planetExpressCapabilities(input: { extensionPaired: boolean }): ForwarderCapabilities {
	const base: CapabilityStatus = input.extensionPaired ? "ok" : "unavailable";
	return {
		packages: base,
		consolidate: base,
		// Real money commit — interactive (user clicks). Status `ok` here
		// just means we can drive the UI; the user still confirms.
		ship: base,
	};
}
