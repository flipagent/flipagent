/**
 * Notification subscription tools — eBay's Platform Notifications,
 * normalized. Distinct from `flipagent_webhooks_*` (which targets
 * flipagent-emitted events): this is the upstream eBay event stream.
 */

import { NotificationSubscriptionCreate } from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { getClient, toolErrorEnvelope } from "../client.js";
import type { Config } from "../config.js";

/* ----------------------- flipagent_notifications_topics -------------------- */

export const notificationsTopicsInput = Type.Object({});
export const notificationsTopicsDescription =
	"List the available eBay Platform Notification topics (upstream event types: ItemSold, ItemRevised, AccountSuspended, etc.). Calls GET /v1/notifications/topics. **When to use** — required before `flipagent_create_notification_subscription` to know which topicId to subscribe to. Distinct from `flipagent_register_webhook` (which targets flipagent-emitted events) — this is the eBay-side stream. **Inputs** — none. **Output** — `{ topics: [{ id, name, description, payloadShape }] }`. **Prereqs** — eBay seller account connected. **Example** — call with `{}`.";
export async function notificationsTopicsExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.notifications.topics();
	} catch (err) {
		return toolErrorEnvelope(err, "notifications_topics_failed", "/v1/notifications/topics");
	}
}

/* ------------------- flipagent_notifications_destinations ------------------ */

export const notificationsDestinationsInput = Type.Object({});
export const notificationsDestinationsDescription =
	"List configured destinations (HTTPS endpoints, queues) where eBay notifications can be delivered. Calls GET /v1/notifications/destinations. **When to use** — find a destination id to use in `flipagent_create_notification_subscription`. **Inputs** — none. **Output** — `{ destinations: [{ id, type, endpoint, status }] }`. **Prereqs** — eBay seller account connected. **Example** — call with `{}`.";
export async function notificationsDestinationsExecute(
	config: Config,
	_args: Record<string, unknown>,
): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.notifications.destinations();
	} catch (err) {
		return toolErrorEnvelope(err, "notifications_destinations_failed", "/v1/notifications/destinations");
	}
}

/* ------------------ flipagent_notifications_subscriptions_list ------------- */

export const notificationsSubscriptionsListInput = Type.Object({});
export const notificationsSubscriptionsListDescription =
	"List active eBay-notification subscriptions on the connected account. Calls GET /v1/notifications/subscriptions. **When to use** — audit which topics are wired to which destinations; debug missing-event issues. **Inputs** — none. **Output** — `{ subscriptions: [{ id, topicId, destinationId, status, createdAt }] }`. **Prereqs** — eBay seller account connected. **Example** — call with `{}`.";
export async function notificationsSubscriptionsListExecute(
	config: Config,
	_args: Record<string, unknown>,
): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.notifications.listSubscriptions();
	} catch (err) {
		return toolErrorEnvelope(err, "notifications_subscriptions_list_failed", "/v1/notifications/subscriptions");
	}
}

/* ----------------- flipagent_notifications_subscriptions_create ------------ */

export { NotificationSubscriptionCreate as notificationsSubscriptionsCreateInput };
export const notificationsSubscriptionsCreateDescription =
	'Subscribe to one eBay Platform Notification topic, routed to one destination. Calls POST /v1/notifications/subscriptions. **When to use** — react to upstream eBay events (item sold, item revised, account suspension) without polling. **Inputs** — `topicId` (from `flipagent_list_notification_topics`), `destinationId` (from `flipagent_list_notification_destinations`). **Output** — `{ id, topicId, destinationId, status, createdAt }`. **Prereqs** — eBay seller account connected; destination must already exist. **Example** — `{ topicId: "ITEM_SOLD", destinationId: "DST-1" }`.';
export async function notificationsSubscriptionsCreateExecute(
	config: Config,
	args: Record<string, unknown>,
): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.notifications.createSubscription(
			args as Parameters<typeof client.notifications.createSubscription>[0],
		);
	} catch (err) {
		return toolErrorEnvelope(err, "notifications_subscriptions_create_failed", "/v1/notifications/subscriptions");
	}
}

/* ------------------ flipagent_notifications_subscriptions_get -------------- */

export const notificationsSubscriptionsGetInput = Type.Object({ id: Type.String({ minLength: 1 }) });
export const notificationsSubscriptionsGetDescription =
	'Fetch one eBay-notification subscription by id. Calls GET /v1/notifications/subscriptions/{id}. **When to use** — read a single subscription\'s full state (delivery stats, last error). **Inputs** — `id`. **Output** — full Subscription object including delivery counters. **Prereqs** — eBay seller account connected. **Example** — `{ id: "SUB-1" }`.';
export async function notificationsSubscriptionsGetExecute(
	config: Config,
	args: Record<string, unknown>,
): Promise<unknown> {
	const id = String(args.id);
	try {
		const client = getClient(config);
		return await client.notifications.getSubscription(id);
	} catch (err) {
		return toolErrorEnvelope(err, "notifications_subscriptions_get_failed", `/v1/notifications/subscriptions/${id}`);
	}
}

/* ----------------- flipagent_notifications_subscriptions_delete ------------ */

export const notificationsSubscriptionsDeleteInput = Type.Object({ id: Type.String({ minLength: 1 }) });
export const notificationsSubscriptionsDeleteDescription =
	'Delete one eBay-notification subscription. Calls DELETE /v1/notifications/subscriptions/{id}. **When to use** — stop a topic from delivering further events to its destination. **Inputs** — `id`. **Output** — `{ id, removed: true }`. **Prereqs** — eBay seller account connected. **Example** — `{ id: "SUB-1" }`.';
export async function notificationsSubscriptionsDeleteExecute(
	config: Config,
	args: Record<string, unknown>,
): Promise<unknown> {
	const id = String(args.id);
	try {
		const client = getClient(config);
		return await client.notifications.deleteSubscription(id);
	} catch (err) {
		return toolErrorEnvelope(
			err,
			"notifications_subscriptions_delete_failed",
			`/v1/notifications/subscriptions/${id}`,
		);
	}
}

/* ----------------- flipagent_notifications_subscription_enable ------------- */

export const notificationsSubEnableInput = Type.Object({ id: Type.String({ minLength: 1 }) });
export const notificationsSubEnableDescription =
	"Enable a previously-disabled subscription. Calls POST /v1/notifications/subscriptions/{id}/enable. **Inputs** — `id`. **Output** — empty 204.";
export async function notificationsSubEnableExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const id = String(args.id);
	try {
		const client = getClient(config);
		await client.notifications.enableSubscription(id);
		return { id, enabled: true };
	} catch (err) {
		return toolErrorEnvelope(err, "notifications_sub_enable_failed", `/v1/notifications/subscriptions/${id}/enable`);
	}
}

/* ---------------- flipagent_notifications_subscription_disable ------------- */

export const notificationsSubDisableInput = Type.Object({ id: Type.String({ minLength: 1 }) });
export const notificationsSubDisableDescription =
	"Disable an active subscription so events stop firing without deleting it. Calls POST /v1/notifications/subscriptions/{id}/disable. **Inputs** — `id`. **Output** — empty 204.";
export async function notificationsSubDisableExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const id = String(args.id);
	try {
		const client = getClient(config);
		await client.notifications.disableSubscription(id);
		return { id, disabled: true };
	} catch (err) {
		return toolErrorEnvelope(
			err,
			"notifications_sub_disable_failed",
			`/v1/notifications/subscriptions/${id}/disable`,
		);
	}
}

/* ----------------- flipagent_notifications_subscription_test --------------- */

export const notificationsSubTestInput = Type.Object({ id: Type.String({ minLength: 1 }) });
export const notificationsSubTestDescription =
	"Send a test event to the subscription's destination. Calls POST /v1/notifications/subscriptions/{id}/test. **When to use** — verify webhook delivery + signature round-trip works end-to-end before relying on live events. **Inputs** — `id`. **Output** — empty 204; check the destination's inbox for the test payload.";
export async function notificationsSubTestExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const id = String(args.id);
	try {
		const client = getClient(config);
		await client.notifications.testSubscription(id);
		return { id, dispatched: true };
	} catch (err) {
		return toolErrorEnvelope(err, "notifications_sub_test_failed", `/v1/notifications/subscriptions/${id}/test`);
	}
}

/* ---------------- flipagent_notifications_subscription_add_filter ---------- */

export const notificationsSubAddFilterInput = Type.Object({
	subscriptionId: Type.String({ minLength: 1 }),
	expression: Type.String({ minLength: 1 }),
});
export const notificationsSubAddFilterDescription =
	"Attach a filter expression to a subscription so only matching events fire. Calls POST /v1/notifications/subscriptions/{id}/filters. **When to use** — narrow a noisy topic to events for one listing/buyer/category. See eBay's filter expression syntax docs. **Inputs** — `subscriptionId`, `expression` (e.g. `\"itemId='1234567890'\"`). **Output** — `{ filterId }`.";
export async function notificationsSubAddFilterExecute(
	config: Config,
	args: Record<string, unknown>,
): Promise<unknown> {
	const { subscriptionId, expression } = args as { subscriptionId: string; expression: string };
	try {
		const client = getClient(config);
		return await client.notifications.addFilter(subscriptionId, expression);
	} catch (err) {
		return toolErrorEnvelope(
			err,
			"notifications_sub_add_filter_failed",
			`/v1/notifications/subscriptions/${subscriptionId}/filters`,
		);
	}
}

/* --------------- flipagent_notifications_subscription_delete_filter -------- */

export const notificationsSubDeleteFilterInput = Type.Object({
	subscriptionId: Type.String({ minLength: 1 }),
	filterId: Type.String({ minLength: 1 }),
});
export const notificationsSubDeleteFilterDescription =
	"Remove one filter from a subscription. Calls DELETE /v1/notifications/subscriptions/{id}/filters/{filterId}. **Inputs** — `subscriptionId`, `filterId`. **Output** — empty 204.";
export async function notificationsSubDeleteFilterExecute(
	config: Config,
	args: Record<string, unknown>,
): Promise<unknown> {
	const { subscriptionId, filterId } = args as { subscriptionId: string; filterId: string };
	try {
		const client = getClient(config);
		await client.notifications.deleteFilter(subscriptionId, filterId);
		return { subscriptionId, filterId, removed: true };
	} catch (err) {
		return toolErrorEnvelope(
			err,
			"notifications_sub_delete_filter_failed",
			`/v1/notifications/subscriptions/${subscriptionId}/filters/${filterId}`,
		);
	}
}

/* ----------------------- flipagent_notifications_config -------------------- */

export const notificationsConfigGetInput = Type.Object({});
export const notificationsConfigGetDescription =
	"Get the marketplace notifications config (alert email destination eBay uses for delivery-failure escalation). Calls GET /v1/notifications/config.";
export async function notificationsConfigGetExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.notifications.getConfig();
	} catch (err) {
		return toolErrorEnvelope(err, "notifications_config_get_failed", "/v1/notifications/config");
	}
}

export const notificationsConfigUpdateInput = Type.Object({
	alertEmail: Type.Union([Type.String(), Type.Null()]),
});
export const notificationsConfigUpdateDescription =
	"Update the notifications alert-email config. Calls PUT /v1/notifications/config. eBay routes delivery-failure escalations to this address. **Inputs** — `{ alertEmail }` (string or null to clear). **Output** — empty 204.";
export async function notificationsConfigUpdateExecute(
	config: Config,
	args: Record<string, unknown>,
): Promise<unknown> {
	try {
		const client = getClient(config);
		await client.notifications.updateConfig(args as { alertEmail: string | null });
		return { ok: true };
	} catch (err) {
		return toolErrorEnvelope(err, "notifications_config_update_failed", "/v1/notifications/config");
	}
}

/* --------------------- flipagent_notifications_public_key ------------------ */

export const notificationsPublicKeyInput = Type.Object({ keyId: Type.String({ minLength: 1 }) });
export const notificationsPublicKeyDescription =
	"Fetch the eBay-issued public signing key for a given keyId (the `kid` header on inbound notifications references one). Calls GET /v1/notifications/public-keys/{id}. **When to use** — verify webhook signatures locally. eBay rotates these; cache by keyId. **Inputs** — `keyId`. **Output** — `{ keyId, algorithm, digest, key }`.";
export async function notificationsPublicKeyExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const keyId = String(args.keyId);
	try {
		const client = getClient(config);
		return await client.notifications.getPublicKey(keyId);
	} catch (err) {
		return toolErrorEnvelope(err, "notifications_public_key_failed", `/v1/notifications/public-keys/${keyId}`);
	}
}

/* ----------------------- flipagent_notifications_recent -------------------- */

export const notificationsRecentInput = Type.Object({});
export const notificationsRecentDescription =
	"List recently-delivered eBay notifications across all subscriptions. Calls GET /v1/notifications/recent. **When to use** — debug a missed event (\"the buyer's order didn't trigger our handler\"); audit recent eBay-side activity. **Inputs** — none. **Output** — `{ notifications: [{ id, topicId, deliveredAt, payload, deliveryStatus }] }`. **Prereqs** — eBay seller account connected. **Example** — call with `{}`.";
export async function notificationsRecentExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.notifications.recent();
	} catch (err) {
		return toolErrorEnvelope(err, "notifications_recent_failed", "/v1/notifications/recent");
	}
}
