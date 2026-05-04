/**
 * Bridges flipagent api-key auth into eBay's Trading API token
 * requirement. Every Trading endpoint we wrap (`/v1/messages`,
 * `/v1/offers`, `/v1/feedback`, `/v1/me/selling`, `/v1/me/buying`,
 * `/v1/watching`, `/v1/saved-searches`, `/v1/listings/verify`) needs
 * the connected user's
 * eBay OAuth access token in `X-EBAY-API-IAF-TOKEN`. Without this
 * middleware, each route had to call `getUserAccessToken` + try/catch
 * + map errors itself — duplicated work, drifted error shapes.
 *
 * Wraps a Trading route handler. On miss / failure:
 *   - 401 `ebay_account_not_connected` if the api key has no eBay
 *     OAuth bound (caller hits `/v1/connect/ebay` first).
 *   - 502 `trading_call_failed` for upstream Trading API failures,
 *     with the structured error array surfaced.
 *
 * The handler receives the access token as the second argument so it
 * can pass straight to `tradingCall`.
 */

import type { Context, Env, Input, Next } from "hono";
import { getUserAccessToken } from "../services/ebay/oauth.js";
import { TradingApiError } from "../services/ebay/trading/client.js";
import { nextAction } from "../services/shared/next-action.js";

/**
 * Generic over Hono's request schema (`I`) so a route's
 * `c.req.valid("json")` keeps its TypeBox-derived type when read
 * inside the wrapped handler — no `Static<...>` cast required.
 */
export type TradingHandler<E extends Env = Env, P extends string = string, I extends Input = Input> = (
	c: Context<E, P, I>,
	accessToken: string,
) => Promise<Response>;

export function withTradingAuth<E extends Env = Env, P extends string = string, I extends Input = Input>(
	handler: TradingHandler<E, P, I>,
) {
	return async (c: Context<E, P, I>, _next: Next): Promise<Response> => {
		let token: string;
		try {
			token = await getUserAccessToken(c.var.apiKey.id);
		} catch (err) {
			if (err instanceof Error && err.message === "not_connected") {
				return c.json(
					{
						error: "ebay_account_not_connected",
						message: "Connect an eBay seller account first.",
						next_action: nextAction(c, "ebay_oauth"),
					},
					401,
				);
			}
			const msg = err instanceof Error ? err.message : String(err);
			return c.json({ error: "ebay_token_refresh_failed", message: msg }, 502);
		}
		try {
			return await handler(c, token);
		} catch (err) {
			if (err instanceof TradingApiError) {
				return c.json({ error: "trading_call_failed", callName: err.callName, errors: err.errors }, 502);
			}
			const msg = err instanceof Error ? err.message : String(err);
			return c.json({ error: "trading_call_failed", message: msg }, 502);
		}
	};
}
