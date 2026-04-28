/**
 * Stripe singleton + tier ↔ price-id mapping. Three env vars must be set
 * for billing to work — when any are missing, the routes return 503 with
 * a clear "billing not configured" error so the rest of the api stays up.
 *
 *   STRIPE_SECRET_KEY        sk_live_... or sk_test_...
 *   STRIPE_WEBHOOK_SECRET    whsec_...
 *   STRIPE_PRICE_HOBBY       price_... (recurring monthly)
 *   STRIPE_PRICE_PRO         price_... (recurring monthly)
 */

import Stripe from "stripe";
import type { Tier } from "../auth/keys.js";
import { config, isStripeConfigured } from "../config.js";

export interface StripeConfig {
	secret: string;
	webhookSecret: string;
	prices: { hobby: string; pro: string };
}

export function readStripeConfig(): StripeConfig | null {
	if (!isStripeConfigured()) return null;
	return {
		// `isStripeConfigured()` already proved these four are present.
		secret: config.STRIPE_SECRET_KEY as string,
		webhookSecret: config.STRIPE_WEBHOOK_SECRET as string,
		prices: { hobby: config.STRIPE_PRICE_HOBBY as string, pro: config.STRIPE_PRICE_PRO as string },
	};
}

let cachedClient: Stripe | null = null;
export function stripeClient(cfg: StripeConfig): Stripe {
	if (!cachedClient) {
		cachedClient = new Stripe(cfg.secret, { apiVersion: "2025-02-24.acacia" });
	}
	return cachedClient;
}

export type PaidTier = Extract<Tier, "hobby" | "pro">;

export function priceIdForTier(cfg: StripeConfig, tier: PaidTier): string {
	return cfg.prices[tier];
}

export function tierForPriceId(cfg: StripeConfig, priceId: string): PaidTier | null {
	if (priceId === cfg.prices.hobby) return "hobby";
	if (priceId === cfg.prices.pro) return "pro";
	return null;
}
