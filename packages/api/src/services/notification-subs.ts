/**
 * commerce/notification — subscription + topic + destination CRUD.
 */

import type {
	NotificationDestination,
	NotificationSubscription,
	NotificationSubscriptionCreate,
	NotificationTopic,
} from "@flipagent/types";
import { sellRequest } from "./ebay/rest/user-client.js";

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
	}).catch(() => null);
	return { subscriptions: (res?.subscriptions ?? []).map(toFlipagent) };
}

export async function getSubscription(id: string, ctx: NotifContext): Promise<NotificationSubscription | null> {
	const res = await sellRequest<EbaySubscription>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/commerce/notification/v1/subscription/${encodeURIComponent(id)}`,
	}).catch(() => null);
	return res ? toFlipagent(res) : null;
}

export async function createSubscription(
	input: NotificationSubscriptionCreate,
	ctx: NotifContext,
): Promise<NotificationSubscription> {
	const res = await sellRequest<{ subscriptionId?: string }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/commerce/notification/v1/subscription",
		body: input,
	});
	return {
		id: res?.subscriptionId ?? "",
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

export async function listDestinations(ctx: NotifContext): Promise<{ destinations: NotificationDestination[] }> {
	const res = await sellRequest<{
		destinations?: Array<{
			destinationId: string;
			name: string;
			endpoint: { endpoint: string; verificationToken?: string };
		}>;
	}>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: "/commerce/notification/v1/destination",
	}).catch(() => null);
	return {
		destinations: (res?.destinations ?? []).map((d) => ({
			id: d.destinationId,
			name: d.name,
			endpoint: d.endpoint.endpoint,
			...(d.endpoint.verificationToken ? { credentials: { verificationToken: d.endpoint.verificationToken } } : {}),
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
	}).catch(() => null);
	return {
		topics: (res?.topics ?? []).map((t) => ({
			id: t.topicId,
			...(t.name ? { name: t.name } : {}),
			...(t.description ? { description: t.description } : {}),
			...(t.schemaVersion ? { schemaVersion: t.schemaVersion } : {}),
		})),
	};
}
