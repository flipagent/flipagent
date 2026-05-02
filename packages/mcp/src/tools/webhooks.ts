/**
 * Webhook tools — register / list / revoke server-to-server callbacks
 * for marketplace events (sale, dispute, payout, …). Use during agent
 * setup so flipagent can push state changes to your endpoint instead
 * of forcing the agent to poll.
 */

import { RegisterWebhookRequest } from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

/* ------------------------ flipagent_webhooks_register ---------------------- */

export { RegisterWebhookRequest as webhooksRegisterInput };
export const webhooksRegisterDescription =
	"Register a webhook endpoint. POST /v1/webhooks. Required: `url`, `events[]`. Returns `{ id, secret }` — store `secret` to verify HMAC signatures via the SDK helper.";
export async function webhooksRegisterExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.webhooks.register(args as Parameters<typeof client.webhooks.register>[0]);
	} catch (err) {
		const e = toApiCallError(err, "/v1/webhooks");
		return { error: "webhooks_register_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* -------------------------- flipagent_webhooks_list ------------------------ */

export const webhooksListInput = Type.Object({});
export const webhooksListDescription = "List currently registered webhooks for the api key. GET /v1/webhooks.";
export async function webhooksListExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.webhooks.list();
	} catch (err) {
		const e = toApiCallError(err, "/v1/webhooks");
		return { error: "webhooks_list_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* ------------------------- flipagent_webhooks_revoke ----------------------- */

export const webhooksRevokeInput = Type.Object({ id: Type.String({ minLength: 1 }) });
export const webhooksRevokeDescription = "Revoke a webhook. DELETE /v1/webhooks/{id}. Stops further deliveries.";
export async function webhooksRevokeExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const id = String(args.id);
	try {
		const client = getClient(config);
		await client.webhooks.revoke(id);
		return { id, revoked: true };
	} catch (err) {
		const e = toApiCallError(err, `/v1/webhooks/${id}`);
		return { error: "webhooks_revoke_failed", status: e.status, url: e.url, message: e.message };
	}
}
