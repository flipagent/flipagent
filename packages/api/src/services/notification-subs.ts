/**
 * commerce/notification — subscription + topic + destination CRUD.
 */

import type {
	NotificationDestination,
	NotificationSubscription,
	NotificationSubscriptionCreate,
	NotificationTopic,
} from "@flipagent/types";
import { sellRequest, sellRequestWithLocation, swallow404, swallowEbay404 } from "./ebay/rest/user-client.js";

interface EbaySubscription {
	subscriptionId: string;
	topicId: string;
	destinationId: string;
	status: string;
	filterExpression?: string;
}

function toFlipagent(s: EbaySubscription): NotificationSubscription {
	return {
		id: s.subscriptionId,
		topicId: s.topicId,
		destinationId: s.destinationId,
		status: s.status === "ENABLED" ? "enabled" : "disabled",
		...(s.filterExpression ? { filterExpression: s.filterExpression } : {}),
	};
}

export interface NotifContext {
	apiKeyId: string;
}

export async function listSubscriptions(ctx: NotifContext): Promise<{ subscriptions: NotificationSubscription[] }> {
	const res = await sellRequest<{ subscriptions?: EbaySubscription[] }>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: "/commerce/notification/v1/subscription",
	}).catch(swallowEbay404);
	return { subscriptions: (res?.subscriptions ?? []).map(toFlipagent) };
}

export async function getSubscription(id: string, ctx: NotifContext): Promise<NotificationSubscription | null> {
	const res = await sellRequest<EbaySubscription>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/commerce/notification/v1/subscription/${encodeURIComponent(id)}`,
	}).catch(swallowEbay404);
	return res ? toFlipagent(res) : null;
}

export async function createSubscription(
	input: NotificationSubscriptionCreate,
	ctx: NotifContext,
): Promise<NotificationSubscription> {
	// Subscription request requires `payload: { format, schemaVersion,
	// deliveryProtocol }` per `SubscriptionPayloadDetail` spec — verified
	// live 2026-05-03 ("Invalid or missing schema version. Please refer
	// to /topic/{topic_id} for supported schema versions."). Look up the
	// topic to get its schemaVersion; default format=JSON, protocol=HTTPS
	// (eBay's only supported values today).
	// Verified live 2026-05-03: spec says `format` is a scalar string but
	// eBay's `topic/{topicId}` response returns `format: string[]` (array).
	// Pick the first when looking up the supported payload.
	const topicRes = await sellRequest<{
		supportedPayloads?: Array<{ schemaVersion?: string; format?: string | string[]; deliveryProtocol?: string }>;
	}>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/commerce/notification/v1/topic/${encodeURIComponent(input.topicId)}`,
	}).catch(() => null);
	const supported = topicRes?.supportedPayloads?.[0];
	const format = Array.isArray(supported?.format) ? supported.format[0] : supported?.format;
	const body = {
		topicId: input.topicId,
		destinationId: input.destinationId,
		status: "ENABLED",
		payload: {
			format: format ?? "JSON",
			schemaVersion: supported?.schemaVersion ?? "1.0",
			deliveryProtocol: supported?.deliveryProtocol ?? "HTTPS",
		},
		...(input.filterExpression ? { filter: { criteriaExpression: input.filterExpression } } : {}),
	};
	const { body: res, locationId } = await sellRequestWithLocation<{ subscriptionId?: string }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/commerce/notification/v1/subscription",
		body,
	});
	return {
		id: res?.subscriptionId ?? locationId ?? "",
		topicId: input.topicId,
		destinationId: input.destinationId,
		status: "enabled",
		...(input.filterExpression ? { filterExpression: input.filterExpression } : {}),
	};
}

export async function deleteSubscription(id: string, ctx: NotifContext): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "DELETE",
		path: `/commerce/notification/v1/subscription/${encodeURIComponent(id)}`,
	});
}

export async function getDestination(id: string, ctx: NotifContext): Promise<NotificationDestination | null> {
	const res = await sellRequest<{
		destinationId: string;
		status?: string;
		deliveryConfig?: { endpoint: string; verificationToken?: string };
	}>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/commerce/notification/v1/destination/${encodeURIComponent(id)}`,
	}).catch(swallowEbay404);
	if (!res) return null;
	return {
		id: res.destinationId,
		name: res.destinationId,
		endpoint: res.deliveryConfig?.endpoint ?? "",
		...(res.deliveryConfig?.verificationToken
			? { credentials: { verificationToken: res.deliveryConfig.verificationToken } }
			: {}),
	};
}

export async function createDestination(
	input: { name: string; endpoint: string; verificationToken: string },
	ctx: NotifContext,
): Promise<{ id: string }> {
	const { body, locationId } = await sellRequestWithLocation<{ destinationId?: string }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/commerce/notification/v1/destination",
		body: {
			name: input.name,
			status: "ENABLED",
			deliveryConfig: { endpoint: input.endpoint, verificationToken: input.verificationToken },
		},
	});
	return { id: body?.destinationId ?? locationId ?? "" };
}

export async function updateDestination(
	id: string,
	input: {
		name: string;
		endpoint: string;
		verificationToken: string;
		status?: "ENABLED" | "DISABLED" | "MARKED_DOWN";
	},
	ctx: NotifContext,
): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "PUT",
		path: `/commerce/notification/v1/destination/${encodeURIComponent(id)}`,
		body: {
			name: input.name,
			status: input.status ?? "ENABLED",
			deliveryConfig: { endpoint: input.endpoint, verificationToken: input.verificationToken },
		},
	});
}

export async function deleteDestination(id: string, ctx: NotifContext): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "DELETE",
		path: `/commerce/notification/v1/destination/${encodeURIComponent(id)}`,
	});
}

export async function listDestinations(ctx: NotifContext): Promise<{ destinations: NotificationDestination[] }> {
	// Real eBay response shape (verified live 2026-05-03):
	// `{ destinationId, status, deliveryConfig: { endpoint, verificationToken } }`
	// — NOT `endpoint: { endpoint, ... }` as the previous interface assumed.
	// Previous wrapper crashed with "Cannot read properties of undefined
	// (reading 'endpoint')" the moment any destination existed. `name` is
	// also not returned by eBay; only the destinationId + status + endpoint.
	const res = await sellRequest<{
		destinations?: Array<{
			destinationId: string;
			status?: string;
			deliveryConfig?: { endpoint: string; verificationToken?: string };
		}>;
	}>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: "/commerce/notification/v1/destination",
	}).catch(swallowEbay404);
	return {
		destinations: (res?.destinations ?? []).map((d) => ({
			id: d.destinationId,
			name: d.destinationId,
			endpoint: d.deliveryConfig?.endpoint ?? "",
			...(d.deliveryConfig?.verificationToken
				? { credentials: { verificationToken: d.deliveryConfig.verificationToken } }
				: {}),
		})),
	};
}

export async function listTopics(ctx: NotifContext): Promise<{ topics: NotificationTopic[] }> {
	const res = await sellRequest<{
		topics?: Array<{ topicId: string; name?: string; description?: string; schemaVersion?: string }>;
	}>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: "/commerce/notification/v1/topic",
	}).catch(swallowEbay404);
	return {
		topics: (res?.topics ?? []).map((t) => ({
			id: t.topicId,
			...(t.name ? { name: t.name } : {}),
			...(t.description ? { description: t.description } : {}),
			...(t.schemaVersion ? { schemaVersion: t.schemaVersion } : {}),
		})),
	};
}

export async function enableSubscription(id: string, ctx: NotifContext): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/commerce/notification/v1/subscription/${encodeURIComponent(id)}/enable`,
		body: {},
	});
}

export async function disableSubscription(id: string, ctx: NotifContext): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/commerce/notification/v1/subscription/${encodeURIComponent(id)}/disable`,
		body: {},
	});
}

/**
 * Sends a test event to the destination wired to this subscription.
 * Critical for webhook debugging — confirms the destination URL +
 * verification token round-trip works end-to-end before live events
 * start landing.
 */
export async function testSubscription(id: string, ctx: NotifContext): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/commerce/notification/v1/subscription/${encodeURIComponent(id)}/test`,
		body: {},
	});
}

export interface SubscriptionFilter {
	id: string;
	expression: string;
}

interface UpstreamFilter {
	filterId?: string;
	filterSchema?: string;
	filterExpression?: string;
}

export async function getSubscriptionFilter(
	subscriptionId: string,
	filterId: string,
	ctx: NotifContext,
): Promise<SubscriptionFilter | null> {
	const res = await swallow404(
		sellRequest<UpstreamFilter>({
			apiKeyId: ctx.apiKeyId,
			method: "GET",
			path: `/commerce/notification/v1/subscription/${encodeURIComponent(subscriptionId)}/filter/${encodeURIComponent(filterId)}`,
		}),
	);
	if (!res) return null;
	return {
		id: res.filterId ?? filterId,
		expression: res.filterExpression ?? res.filterSchema ?? "",
	};
}

export async function createSubscriptionFilter(
	subscriptionId: string,
	expression: string,
	ctx: NotifContext,
): Promise<{ filterId: string | null }> {
	// eBay returns the new filterId in the Location header. `sellRequest`
	// returns the parsed body only (typically empty for these creates),
	// so we hit the upstream directly here for the Location header.
	const res = await sellRequest<{ filterId?: string }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/commerce/notification/v1/subscription/${encodeURIComponent(subscriptionId)}/filter`,
		body: { filterSchema: expression },
	});
	return { filterId: res?.filterId ?? null };
}

export async function deleteSubscriptionFilter(
	subscriptionId: string,
	filterId: string,
	ctx: NotifContext,
): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "DELETE",
		path: `/commerce/notification/v1/subscription/${encodeURIComponent(subscriptionId)}/filter/${encodeURIComponent(filterId)}`,
	});
}

export interface NotificationConfig {
	alertEmail: string | null;
}

interface UpstreamConfig {
	alertEmail?: string;
}

export async function getNotificationConfig(ctx: NotifContext): Promise<NotificationConfig> {
	const res = await swallow404(
		sellRequest<UpstreamConfig>({
			apiKeyId: ctx.apiKeyId,
			method: "GET",
			path: "/commerce/notification/v1/config",
		}),
	);
	return { alertEmail: res?.alertEmail ?? null };
}

export async function updateNotificationConfig(body: { alertEmail?: string | null }, ctx: NotifContext): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "PUT",
		path: "/commerce/notification/v1/config",
		body: { alertEmail: body.alertEmail ?? null },
	});
}

export interface PublicKeyResponse {
	keyId: string;
	algorithm: string | null;
	digest: string | null;
	key: string | null;
}

export async function getPublicKey(keyId: string, ctx: NotifContext): Promise<PublicKeyResponse | null> {
	const res = await swallow404(
		sellRequest<{ algorithm?: string; digest?: string; key?: string }>({
			apiKeyId: ctx.apiKeyId,
			method: "GET",
			path: `/commerce/notification/v1/public_key/${encodeURIComponent(keyId)}`,
		}),
	);
	if (!res) return null;
	return {
		keyId,
		algorithm: res.algorithm ?? null,
		digest: res.digest ?? null,
		key: res.key ?? null,
	};
}
