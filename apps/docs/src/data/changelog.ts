/**
 * Static changelog entries surfaced on the dashboard's "What's New" view.
 * Newest first. Add to the top when shipping anything visible. Each entry
 * is rendered as a timeline row.
 */

export type ChangelogTag = "feature" | "improvement" | "fix" | "infra";

export interface ChangelogEntry {
	/** ISO date — YYYY-MM-DD. Used for ordering + the "Mark as read" cursor. */
	date: string;
	tag: ChangelogTag;
	title: string;
	body: string;
}

export const CHANGELOG: ChangelogEntry[] = [
	{
		date: "2026-04-26",
		tag: "feature",
		title: "Dashboard playground + activity replay",
		body: "Sidebar layout with Overview / Playground / Account groups. Search live API endpoints from the browser; replay any past GET call inline from the Activity panel; per-endpoint usage breakdown with avg / p95 latency and error overlay.",
	},
	{
		date: "2026-04-26",
		tag: "feature",
		title: "Email verification + password reset",
		body: "Sign-up triggers a verification link via Resend (when RESEND_API_KEY is set); /signup → Forgot your password? sends a 60-min reset link. Expired-token UX surfaces a friendly panel with a re-request CTA.",
	},
	{
		date: "2026-04-26",
		tag: "feature",
		title: "Better-Auth: GitHub + Google + email/password",
		body: "Replaced the GitHub-only sign-in with a Firecrawl-style chromeless /signup page — Log In / Sign Up tab, email + password form, GitHub / Google / SSO continuation, Last-used badge.",
	},
	{
		date: "2026-04-25",
		tag: "feature",
		title: "@flipagent/forwarder",
		body: "New MIT package: US-domestic forwarder fee estimation (Planet Express handling + USPS/UPS rate-table lookup, zone-banded by destination state). Plugs into @flipagent/quant via the ShippingEstimate structural type.",
	},
	{
		date: "2026-04-25",
		tag: "infra",
		title: "OAuth state shared between API-key and dashboard flows",
		body: "Both /v1/connect/ebay (SDK) and /v1/me/ebay/connect (dashboard) drop into the same in-process state map and post-callback redirects to ${APP_URL}/dashboard/?ebay=connected.",
	},
];
