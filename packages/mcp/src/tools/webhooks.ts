/**
 * Webhook tools — register / list / revoke server-to-server callbacks
 * for marketplace events (sale, dispute, payout, …). Use during agent
 * setup so flipagent can push state changes to your endpoint instead
 * of forcing the agent to poll.
 */

import { RegisterWebhookRequest } from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { getClient, toolErrorEnvelope } from "../client.js";
import type { Config } from "../config.js";

/* ------------------------ flipagent_webhooks_register ---------------------- */

export { RegisterWebhookRequest as webhooksRegisterInput };
export const webhooksRegisterDescription =
	'Register a webhook endpoint to receive flipagent → caller server-to-server callbacks. Calls POST /v1/webhooks. **When to use** — agent setup phase: subscribe to the events you care about (sale, dispute, payout, listing-ended, etc.) so flipagent can push state changes to your endpoint instead of you polling. **Inputs** — `url` (HTTPS endpoint that receives POST), `events: string[]` (event names — see `flipagent_list_notification_topics` for available eBay-side events; flipagent-side events include `sale.created`, `payout.posted`, `dispute.opened`). **Output** — `{ id, secret }`. **Critical**: store `secret` immediately — flipagent uses it for HMAC signatures and won\'t show it again. The SDK ships a verifier helper. **Prereqs** — `FLIPAGENT_API_KEY`. **Example** — `{ url: "https://my-app.example.com/webhooks/flipagent", events: ["sale.created", "dispute.opened"] }`.';
export async function webhooksRegisterExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.webhooks.register(args as Parameters<typeof client.webhooks.register>[0]);
	} catch (err) {
		return toolErrorEnvelope(err, "webhooks_register_failed", "/v1/webhooks");
	}
}

/* -------------------------- flipagent_webhooks_list ------------------------ */

export const webhooksListInput = Type.Object({});
export const webhooksListDescription =
	"List currently-registered webhooks for the api key. Calls GET /v1/webhooks. **When to use** — audit which endpoints are subscribed to which events; debug missing-callback issues. **Inputs** — none. **Output** — `{ webhooks: [{ id, url, events, createdAt }] }`. Note: `secret` is never returned — only `flipagent_register_webhook` ever shows it. **Prereqs** — `FLIPAGENT_API_KEY`. **Example** — call with `{}`.";
export async function webhooksListExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.webhooks.list();
	} catch (err) {
		return toolErrorEnvelope(err, "webhooks_list_failed", "/v1/webhooks");
	}
}

/* ------------------------- flipagent_webhooks_revoke ----------------------- */

export const webhooksRevokeInput = Type.Object({ id: Type.String({ minLength: 1 }) });
export const webhooksRevokeDescription =
	'Revoke a webhook so flipagent stops delivering events to that URL. Calls DELETE /v1/webhooks/{id}. **When to use** — endpoint deprecated, secret leaked, or rotating to a new URL. **Inputs** — `id` (from `flipagent_list_webhooks`). **Output** — `{ id, revoked: true }`. **Prereqs** — `FLIPAGENT_API_KEY`. **Example** — `{ id: "wh_abc123" }`.';
export async function webhooksRevokeExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const id = String(args.id);
	try {
		const client = getClient(config);
		await client.webhooks.revoke(id);
		return { id, revoked: true };
	} catch (err) {
		return toolErrorEnvelope(err, "webhooks_revoke_failed", `/v1/webhooks/${id}`);
	}
}
