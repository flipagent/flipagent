/**
 * Public-facing URLs for forwarder providers (Planet Express today).
 * Centralised so referral codes attach uniformly: every "go sign up
 * for PE" surface (next-action hints, capabilities feed, dashboard
 * onboarding) routes through here instead of hard-coding `/signup`.
 */

import { config } from "../../config.js";

export function planetExpressSignupUrl(): string {
	const code = config.PLANET_EXPRESS_REFERRAL_CODE.trim();
	return code ? `https://planetexpress.com/?ref=${encodeURIComponent(code)}` : "https://planetexpress.com/signup";
}
