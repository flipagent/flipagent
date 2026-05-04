/**
 * Stripe singleton + tier ↔ price-id mapping. All five env vars must be
 * set for billing to work — when any are missing, the routes return 503
 * with a clear "billing not configured" error so the rest of the api
 * stays up.
 *
 *   STRIPE_SECRET_KEY         sk_live_... or sk_test_...
 *   STRIPE_WEBHOOK_SECRET     whsec_...
 *   STRIPE_PRICE_HOBBY        price_... (recurring monthly — Hobby $19)
 *   STRIPE_PRICE_STANDARD     price_... (recurring monthly — Standard $99)
 *   STRIPE_PRICE_GROWTH       price_... (recurring monthly — Growth $399)
 *
 * One-time top-up purchases (manual packs + auto-recharge) don't use
 * pre-created Stripe Prices — pricing is tier-aware (per-credit unit
 * price varies by tier, see `auth/limits.ts:PER_CREDIT_USD`) so we
 * construct `price_data` at checkout time. One source of truth in
 * code, no SKU sprawl.
 */

import Stripe from "stripe";
import type { Tier } from "../auth/keys.js";
import { config, isStripeConfigured } from "../config.js";

export interface StripeConfig {
	secret: string;
	webhookSecret: string;
	prices: { hobby: string; standard: string; growth: string };
}

export function readStripeConfig(): StripeConfig | null {
	if (!isStripeConfigured()) return null;
	return {
		// `isStripeConfigured()` already proved these are all present.
		secret: config.STRIPE_SECRET_KEY as string,
		webhookSecret: config.STRIPE_WEBHOOK_SECRET as string,
		prices: {
			hobby: config.STRIPE_PRICE_HOBBY as string,
			standard: config.STRIPE_PRICE_STANDARD as string,
			growth: config.STRIPE_PRICE_GROWTH as string,
		},
	};
}

let cachedClient: Stripe | null = null;
export function stripeClient(cfg: StripeConfig): Stripe {
	if (!cachedClient) {
		cachedClient = new Stripe(cfg.secret, { apiVersion: "2025-02-24.acacia" });
	}
	return cachedClient;
}

export type PaidTier = Extract<Tier, "hobby" | "standard" | "growth">;

export function priceIdForTier(cfg: StripeConfig, tier: PaidTier): string {
	return cfg.prices[tier];
}

export function tierForPriceId(cfg: StripeConfig, priceId: string): PaidTier | null {
	if (priceId === cfg.prices.hobby) return "hobby";
	if (priceId === cfg.prices.standard) return "standard";
	if (priceId === cfg.prices.growth) return "growth";
	return null;
}
