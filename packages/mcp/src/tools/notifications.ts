/**
 * Notification subscription tools — eBay's Platform Notifications,
 * normalized. Distinct from `flipagent_webhooks_*` (which targets
 * flipagent-emitted events): this is the upstream eBay event stream.
 */

import { NotificationSubscriptionCreate } from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

/* ----------------------- flipagent_notifications_topics -------------------- */

export const notificationsTopicsInput = Type.Object({});
export const notificationsTopicsDescription =
	"List the available eBay notification topics (event types). GET /v1/notifications/topics. Read this before `flipagent_notifications_subscriptions_create` to know what to subscribe to.";
export async function notificationsTopicsExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.notifications.topics();
	} catch (err) {
		const e = toApiCallError(err, "/v1/notifications/topics");
		return { error: "notifications_topics_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* ------------------- flipagent_notifications_destinations ------------------ */

export const notificationsDestinationsInput = Type.Object({});
export const notificationsDestinationsDescription =
	"List configured destinations for notifications. GET /v1/notifications/destinations.";
export async function notificationsDestinationsExecute(
	config: Config,
	_args: Record<string, unknown>,
): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.notifications.destinations();
	} catch (err) {
		const e = toApiCallError(err, "/v1/notifications/destinations");
		return { error: "notifications_destinations_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* ------------------ flipagent_notifications_subscriptions_list ------------- */

export const notificationsSubscriptionsListInput = Type.Object({});
export const notificationsSubscriptionsListDescription =
	"List active notification subscriptions. GET /v1/notifications/subscriptions.";
export async function notificationsSubscriptionsListExecute(
	config: Config,
	_args: Record<string, unknown>,
): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.notifications.listSubscriptions();
	} catch (err) {
		const e = toApiCallError(err, "/v1/notifications/subscriptions");
		return { error: "notifications_subscriptions_list_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* ----------------- flipagent_notifications_subscriptions_create ------------ */

export { NotificationSubscriptionCreate as notificationsSubscriptionsCreateInput };
export const notificationsSubscriptionsCreateDescription =
	"Create a notification subscription. POST /v1/notifications/subscriptions. Required: `topicId` (from `flipagent_notifications_topics`), destination.";
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
		const e = toApiCallError(err, "/v1/notifications/subscriptions");
		return { error: "notifications_subscriptions_create_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* ------------------ flipagent_notifications_subscriptions_get -------------- */

export const notificationsSubscriptionsGetInput = Type.Object({ id: Type.String({ minLength: 1 }) });
export const notificationsSubscriptionsGetDescription =
	"Fetch one notification subscription. GET /v1/notifications/subscriptions/{id}.";
export async function notificationsSubscriptionsGetExecute(
	config: Config,
	args: Record<string, unknown>,
): Promise<unknown> {
	const id = String(args.id);
	try {
		const client = getClient(config);
		return await client.notifications.getSubscription(id);
	} catch (err) {
		const e = toApiCallError(err, `/v1/notifications/subscriptions/${id}`);
		return { error: "notifications_subscriptions_get_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* ----------------- flipagent_notifications_subscriptions_delete ------------ */

export const notificationsSubscriptionsDeleteInput = Type.Object({ id: Type.String({ minLength: 1 }) });
export const notificationsSubscriptionsDeleteDescription =
	"Delete a notification subscription. DELETE /v1/notifications/subscriptions/{id}.";
export async function notificationsSubscriptionsDeleteExecute(
	config: Config,
	args: Record<string, unknown>,
): Promise<unknown> {
	const id = String(args.id);
	try {
		const client = getClient(config);
		return await client.notifications.deleteSubscription(id);
	} catch (err) {
		const e = toApiCallError(err, `/v1/notifications/subscriptions/${id}`);
		return { error: "notifications_subscriptions_delete_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* ----------------------- flipagent_notifications_recent -------------------- */

export const notificationsRecentInput = Type.Object({});
export const notificationsRecentDescription =
	"List recent delivered notifications. GET /v1/notifications/recent. Use to debug missed events.";
export async function notificationsRecentExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.notifications.recent();
	} catch (err) {
		const e = toApiCallError(err, "/v1/notifications/recent");
		return { error: "notifications_recent_failed", status: e.status, url: e.url, message: e.message };
	}
}
