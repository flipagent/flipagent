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
	enableSubscription(id: string): Promise<void>;
	disableSubscription(id: string): Promise<void>;
	testSubscription(id: string): Promise<void>;
	addFilter(subscriptionId: string, expression: string): Promise<{ filterId: string | null }>;
	getFilter(subscriptionId: string, filterId: string): Promise<{ id: string; expression: string }>;
	deleteFilter(subscriptionId: string, filterId: string): Promise<void>;
	getConfig(): Promise<{ alertEmail: string | null }>;
	updateConfig(body: { alertEmail?: string | null }): Promise<void>;
	getPublicKey(
		keyId: string,
	): Promise<{ keyId: string; algorithm: string | null; digest: string | null; key: string | null }>;
	recent(): Promise<unknown>;
}

export function createNotificationsClient(http: FlipagentHttp): NotificationsClient {
	const sub = (id: string) => `/v1/notifications/subscriptions/${encodeURIComponent(id)}`;
	return {
		topics: () => http.get("/v1/notifications/topics"),
		destinations: () => http.get("/v1/notifications/destinations"),
		listSubscriptions: () => http.get("/v1/notifications/subscriptions"),
		createSubscription: (body) => http.post("/v1/notifications/subscriptions", body),
		getSubscription: (id) => http.get(sub(id)),
		deleteSubscription: (id) => http.delete(sub(id)),
		enableSubscription: (id) => http.post(`${sub(id)}/enable`),
		disableSubscription: (id) => http.post(`${sub(id)}/disable`),
		testSubscription: (id) => http.post(`${sub(id)}/test`),
		addFilter: (id, expression) => http.post(`${sub(id)}/filters`, { expression }),
		getFilter: (id, filterId) => http.get(`${sub(id)}/filters/${encodeURIComponent(filterId)}`),
		deleteFilter: (id, filterId) => http.delete(`${sub(id)}/filters/${encodeURIComponent(filterId)}`),
		getConfig: () => http.get("/v1/notifications/config"),
		updateConfig: (body) => http.put("/v1/notifications/config", body),
		getPublicKey: (keyId) => http.get(`/v1/notifications/public-keys/${encodeURIComponent(keyId)}`),
		recent: () => http.get("/v1/notifications/recent"),
	};
}
