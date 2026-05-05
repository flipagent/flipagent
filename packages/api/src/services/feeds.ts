/**
 * sell/feed + buy/feed — bulk async tasks.
 */

import type { FeedKind, FeedTask, FeedTaskCreate, FeedTaskStatus } from "@flipagent/types";
import { sellRequest, swallowEbay404 } from "./ebay/rest/user-client.js";

const STATUS_FROM: Record<string, FeedTaskStatus> = {
	QUEUED: "queued",
	IN_PROCESS: "processing",
	COMPLETED: "completed",
	COMPLETED_WITH_ERROR: "completed",
	FAILED: "failed",
	CANCELED: "cancelled",
};

const SELL_KINDS: ReadonlySet<FeedKind> = new Set(["listing", "inventory", "order", "customer_service_metric"]);

interface EbayFeedTask {
	taskId: string;
	feedType: string;
	schemaVersion?: string;
	status: string;
	uploadUrl?: string;
	downloadUrl?: string;
	creationDate?: string;
	completionDate?: string;
}

function ebayTaskToFlipagent(t: EbayFeedTask, kind: FeedKind): FeedTask {
	return {
		id: t.taskId,
		marketplace: "ebay_us",
		kind,
		status: STATUS_FROM[t.status] ?? "queued",
		feedType: t.feedType,
		...(t.schemaVersion ? { schemaVersion: t.schemaVersion } : {}),
		...(t.uploadUrl ? { uploadUrl: t.uploadUrl } : {}),
		...(t.downloadUrl ? { downloadUrl: t.downloadUrl } : {}),
		createdAt: t.creationDate ?? "",
		...(t.completionDate ? { completedAt: t.completionDate } : {}),
	};
}

export interface FeedsContext {
	apiKeyId: string;
	marketplace?: string;
}

function pathBase(kind: FeedKind): string {
	return SELL_KINDS.has(kind) ? "/sell/feed/v1" : "/buy/feed/v1_beta";
}

function resourceName(kind: FeedKind): string {
	switch (kind) {
		case "listing":
			return "listing";
		case "inventory":
			return "inventory_task";
		case "order":
			return "order_task";
		case "customer_service_metric":
			return "customer_service_metric_task";
		case "buy_item":
			return "item";
		case "buy_item_group":
			return "item_group";
		case "buy_item_priority_descriptor":
			return "item_priority_descriptor";
		case "buy_item_snapshot":
			return "item_snapshot";
	}
}

export async function listFeedTasks(kind: FeedKind | undefined, ctx: FeedsContext): Promise<{ tasks: FeedTask[] }> {
	const kinds: FeedKind[] = kind ? [kind] : ["listing", "inventory", "order"];
	const all: FeedTask[] = [];
	for (const k of kinds) {
		const res = await sellRequest<{ tasks?: EbayFeedTask[] }>({
			apiKeyId: ctx.apiKeyId,
			method: "GET",
			path: `${pathBase(k)}/${resourceName(k)}`,
			marketplace: ctx.marketplace,
		}).catch(swallowEbay404);
		for (const t of res?.tasks ?? []) all.push(ebayTaskToFlipagent(t, k));
	}
	return { tasks: all };
}

export async function getFeedTask(id: string, kind: FeedKind, ctx: FeedsContext): Promise<FeedTask | null> {
	const res = await sellRequest<EbayFeedTask>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `${pathBase(kind)}/${resourceName(kind)}/${encodeURIComponent(id)}`,
		marketplace: ctx.marketplace,
	}).catch(swallowEbay404);
	return res ? ebayTaskToFlipagent(res, kind) : null;
}

export async function createFeedTask(input: FeedTaskCreate, ctx: FeedsContext): Promise<FeedTask> {
	const res = await sellRequest<{ taskId?: string }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `${pathBase(input.kind)}/${resourceName(input.kind)}`,
		body: { feedType: input.feedType, ...(input.schemaVersion ? { schemaVersion: input.schemaVersion } : {}) },
		marketplace: ctx.marketplace,
	});
	return {
		id: res?.taskId ?? "",
		marketplace: input.marketplace ?? "ebay_us",
		kind: input.kind,
		status: "queued",
		feedType: input.feedType,
		...(input.schemaVersion ? { schemaVersion: input.schemaVersion } : {}),
		createdAt: new Date().toISOString(),
	};
}
