/**
 * `client.notifications.*` — **inbound** events from marketplaces
 * (eBay → flipagent) and the subscription surface that controls them.
 * Distinct from `client.webhooks.*`, which is **outbound**
 * (flipagent → caller).
 */

import type {
	NotificationSubscription,
	NotificationSubscriptionCreate,
	NotificationSubscriptionsListResponse,
} from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface NotificationsClient {
	topics(): Promise<unknown>;
	destinations(): Promise<unknown>;
	listSubscriptions(): Promise<NotificationSubscriptionsListResponse>;
	createSubscription(body: NotificationSubscriptionCreate): Promise<NotificationSubscription>;
	getSubscription(id: string): Promise<NotificationSubscription>;
	deleteSubscription(id: string): Promise<{ id: string; deleted: boolean }>;
	recent(): Promise<unknown>;
}

export function createNotificationsClient(http: FlipagentHttp): NotificationsClient {
	return {
		topics: () => http.get("/v1/notifications/topics"),
		destinations: () => http.get("/v1/notifications/destinations"),
		listSubscriptions: () => http.get("/v1/notifications/subscriptions"),
		createSubscription: (body) => http.post("/v1/notifications/subscriptions", body),
		getSubscription: (id) => http.get(`/v1/notifications/subscriptions/${encodeURIComponent(id)}`),
		deleteSubscription: (id) => http.delete(`/v1/notifications/subscriptions/${encodeURIComponent(id)}`),
		recent: () => http.get("/v1/notifications/recent"),
	};
}
