/**
 * Promoted-Listings tools — campaign / group / report. Backed by
 * `/v1/ads/*`. The seller must pass `flipagent_seller_advertising_eligibility`
 * before any of the create tools will succeed.
 */

import { AdCampaignCreate, AdGroupCreate, ReportTaskCreate } from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { getClient, toolErrorEnvelope } from "../client.js";
import type { Config } from "../config.js";

/* ----------------------- flipagent_ads_campaigns_list ---------------------- */

export const adsCampaignsListInput = Type.Object({});
export const adsCampaignsListDescription =
	'List the seller\'s Promoted-Listings campaigns. Calls GET /v1/ads. **When to use** — review which ad campaigns are running, audit budget allocation. **Inputs** — none. **Output** — `{ campaigns: [{ id, name, status, fundingModel: "PRIORITY_LISTING" | "GENERAL" | "OFFSITE", budget, startsAt, endsAt? }] }`. **Prereqs** — eBay seller account connected; advertising eligibility (check `flipagent_get_seller_advertising_eligibility`). On 401 the response carries `next_action`. **Example** — call with `{}`.';
export async function adsCampaignsListExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.ads.listCampaigns();
	} catch (err) {
		return toolErrorEnvelope(err, "ads_campaigns_list_failed", "/v1/ads");
	}
}

/* ---------------------- flipagent_ads_campaigns_create --------------------- */

export { AdCampaignCreate as adsCampaignsCreateInput };
export const adsCampaignsCreateDescription =
	'Create a Promoted-Listings campaign. Calls POST /v1/ads. **When to use** — boost slow-moving listings with paid placement. Always call `flipagent_get_seller_advertising_eligibility` first to confirm the seller is approved for the funding model you want. **Inputs** — `name`, `fundingModel` (`PRIORITY_LISTING | GENERAL | OFFSITE`), `startsAt`, optional `endsAt`, `budget` (cents-int daily/monthly). **Output** — `{ id, status: "draft", ... }` — campaign starts as draft; add ad groups via `flipagent_create_ad_group` before it can serve. **Prereqs** — eBay seller account connected, advertising eligibility for the chosen `fundingModel`. **Example** — `{ name: "Spring camera push", fundingModel: "PRIORITY_LISTING", startsAt: "2026-05-01T00:00:00Z", budget: { dailyCents: 5000, currency: "USD" } }`.';
export async function adsCampaignsCreateExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.ads.createCampaign(args as Parameters<typeof client.ads.createCampaign>[0]);
	} catch (err) {
		return toolErrorEnvelope(err, "ads_campaigns_create_failed", "/v1/ads");
	}
}

/* ------------------------- flipagent_ads_ads_list -------------------------- */

export const adsAdsListInput = Type.Object({ campaignId: Type.String({ minLength: 1 }) });
export const adsAdsListDescription =
	'List the individual ads (per-listing entries) inside one campaign. Calls GET /v1/ads/{campaignId}/ads. **When to use** — see which listings a campaign is actually promoting and at what bid. **Inputs** — `campaignId`. **Output** — `{ ads: [{ id, listingId, bid, status }] }`. **Prereqs** — eBay seller account connected. **Example** — `{ campaignId: "CMP-1" }`.';
export async function adsAdsListExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const campaignId = String(args.campaignId);
	try {
		const client = getClient(config);
		return await client.ads.listAds(campaignId);
	} catch (err) {
		return toolErrorEnvelope(err, "ads_ads_list_failed", `/v1/ads/${campaignId}/ads`);
	}
}

/* ------------------------ flipagent_ads_groups_list ------------------------ */

export const adsGroupsListInput = Type.Object({ campaignId: Type.String({ minLength: 1 }) });
export const adsGroupsListDescription =
	'List the ad groups inside one campaign. Calls GET /v1/ads/{campaignId}/groups. **When to use** — campaigns own one-to-many ad groups; each group bundles a bid + targeting rule. List groups to audit structure before adding more. **Inputs** — `campaignId`. **Output** — `{ groups: [{ id, name, bid, rules: { categoryIds?, listingIds? }, status }] }`. **Prereqs** — eBay seller account connected. **Example** — `{ campaignId: "CMP-1" }`.';
export async function adsGroupsListExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const campaignId = String(args.campaignId);
	try {
		const client = getClient(config);
		return await client.ads.listGroups(campaignId);
	} catch (err) {
		return toolErrorEnvelope(err, "ads_groups_list_failed", `/v1/ads/${campaignId}/groups`);
	}
}

/* ----------------------- flipagent_ads_groups_create ----------------------- */

export const adsGroupsCreateInput = Type.Composite([
	Type.Object({ campaignId: Type.String({ minLength: 1 }) }),
	AdGroupCreate,
]);
export const adsGroupsCreateDescription =
	'Add an ad group inside a campaign. Calls POST /v1/ads/{campaignId}/groups. **When to use** — required next step after `flipagent_create_ad_campaign` (which only creates a draft envelope); the group carries the actual targeting + bid. **Inputs** — `campaignId`, `name`, `bid` (cents-int per click for GENERAL, percent for PRIORITY_LISTING), `rules: { categoryIds?: string[], listingIds?: string[] }`. **Output** — full ad group object. **Prereqs** — eBay seller account connected, campaign exists, advertising eligibility. **Example** — `{ campaignId: "CMP-1", name: "Lenses", bid: { percent: 5 }, rules: { categoryIds: ["31388"] } }`.';
export async function adsGroupsCreateExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const { campaignId, ...body } = args as { campaignId: string } & Record<string, unknown>;
	try {
		const client = getClient(config);
		return await client.ads.createGroup(campaignId, body as Parameters<typeof client.ads.createGroup>[1]);
	} catch (err) {
		return toolErrorEnvelope(err, "ads_groups_create_failed", `/v1/ads/${campaignId}/groups`);
	}
}

/* --------------------- flipagent_ads_reports_metadata ---------------------- */

export const adsReportsMetadataInput = Type.Object({});
export const adsReportsMetadataDescription =
	"Read the schema for ads-performance reports — available dimensions, metrics, valid date ranges. Calls GET /v1/ads/reports/metadata. **When to use** — required before `flipagent_create_ad_report` so you know which fields are valid (eBay's metric set evolves). **Inputs** — none. **Output** — `{ dimensions: [...], metrics: [...], dateRanges: [...] }`. **Prereqs** — eBay seller account connected. **Example** — call with `{}`.";
export async function adsReportsMetadataExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.ads.reportMetadata();
	} catch (err) {
		return toolErrorEnvelope(err, "ads_reports_metadata_failed", "/v1/ads/reports/metadata");
	}
}

/* ----------------------- flipagent_ads_reports_list ------------------------ */

export const adsReportsListInput = Type.Object({});
export const adsReportsListDescription =
	"List queued and completed ads-report tasks. Calls GET /v1/ads/reports/tasks. **When to use** — find a previously-queued report's id; audit which reports have run. **Inputs** — none. **Output** — `{ tasks: [{ id, status, queuedAt, completedAt? }] }`. **Prereqs** — eBay seller account connected. **Example** — call with `{}`.";
export async function adsReportsListExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.ads.listReportTasks();
	} catch (err) {
		return toolErrorEnvelope(err, "ads_reports_list_failed", "/v1/ads/reports/tasks");
	}
}

/* ----------------------- flipagent_ads_reports_create ---------------------- */

export { ReportTaskCreate as adsReportsCreateInput };
export const adsReportsCreateDescription =
	'Queue a Promoted-Listings performance report (async). Calls POST /v1/ads/reports/tasks. **When to use** — measure ad ROI: spend, clicks, attributed sales. Reports compute server-side (1–10 min); poll `flipagent_get_ad_report` until terminal. **Inputs** — `dimensions`, `metrics`, `from`/`to` ISO dates, optional `campaignIds`. Read `flipagent_get_ad_report_metadata` first to know valid values. **Output** — `{ id, status: "queued", poll_with: "flipagent_get_ad_report", terminal_states: ["succeeded", "failed"] }`. **Prereqs** — eBay seller account connected, advertising eligibility. **Example** — `{ dimensions: ["campaign"], metrics: ["impressions", "clicks", "attributedSales"], from: "2026-04-01", to: "2026-04-30" }`.';
export async function adsReportsCreateExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.ads.createReportTask(args as Parameters<typeof client.ads.createReportTask>[0]);
	} catch (err) {
		return toolErrorEnvelope(err, "ads_reports_create_failed", "/v1/ads/reports/tasks");
	}
}

/* ------------------------ flipagent_ads_reports_get ------------------------ */

export const adsReportsGetInput = Type.Object({ id: Type.String({ minLength: 1 }) });
export const adsReportsGetDescription =
	'Poll one ads-performance report task. Calls GET /v1/ads/reports/tasks/{id}. **When to use** — after `flipagent_create_ad_report`, poll until terminal. **Inputs** — `id`. **Output** — `{ id, status: "queued" | "running" | "succeeded" | "failed", result?: { rows: [...], totals: {...} }, error? }`. **Prereqs** — eBay seller account connected. **Example** — `{ id: "RPT-abc123" }`.';
export async function adsReportsGetExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const id = String(args.id);
	try {
		const client = getClient(config);
		return await client.ads.getReportTask(id);
	} catch (err) {
		return toolErrorEnvelope(err, "ads_reports_get_failed", `/v1/ads/reports/tasks/${id}`);
	}
}

/* ─── campaign lifecycle ─── */

export const adsCampaignByNameInput = Type.Object({ name: Type.String({ minLength: 1 }) });
export const adsCampaignByNameDescription =
	"Find a campaign by exact name. Calls GET /v1/ads/by-name. **Inputs** — `name`. **Output** — full campaign object or 404. Useful for idempotent script flows that look up a known campaign before re-creating.";
export async function adsCampaignByNameExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.ads.getCampaignByName(String(args.name));
	} catch (err) {
		return toolErrorEnvelope(err, "ads_campaign_by_name_failed", "/v1/ads/by-name");
	}
}

const campaignIdInput = Type.Object({ campaignId: Type.String({ minLength: 1 }) });

export const adsCampaignPauseInput = campaignIdInput;
export const adsCampaignPauseDescription =
	"Pause an active ad campaign (events stop accruing impressions/clicks). Calls POST /v1/ads/{id}/pause.";
export async function adsCampaignPauseExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const id = String(args.campaignId);
	try {
		await getClient(config).ads.pauseCampaign(id);
		return { campaignId: id, paused: true };
	} catch (err) {
		return toolErrorEnvelope(err, "ads_campaign_pause_failed", `/v1/ads/${id}/pause`);
	}
}

export const adsCampaignResumeInput = campaignIdInput;
export const adsCampaignResumeDescription = "Resume a paused ad campaign. Calls POST /v1/ads/{id}/resume.";
export async function adsCampaignResumeExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const id = String(args.campaignId);
	try {
		await getClient(config).ads.resumeCampaign(id);
		return { campaignId: id, resumed: true };
	} catch (err) {
		return toolErrorEnvelope(err, "ads_campaign_resume_failed", `/v1/ads/${id}/resume`);
	}
}

export const adsCampaignEndInput = campaignIdInput;
export const adsCampaignEndDescription =
	"End an ad campaign permanently (terminal — cannot be reactivated; clone instead). Calls POST /v1/ads/{id}/end.";
export async function adsCampaignEndExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const id = String(args.campaignId);
	try {
		await getClient(config).ads.endCampaign(id);
		return { campaignId: id, ended: true };
	} catch (err) {
		return toolErrorEnvelope(err, "ads_campaign_end_failed", `/v1/ads/${id}/end`);
	}
}

export const adsCampaignCloneInput = Type.Object({
	campaignId: Type.String({ minLength: 1 }),
	name: Type.String({ minLength: 1 }),
});
export const adsCampaignCloneDescription =
	"Clone a campaign under a new name. Calls POST /v1/ads/{id}/clone. **Inputs** — `campaignId`, `name` (new). **Output** — `{ campaignId }` of the new campaign.";
export async function adsCampaignCloneExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const { campaignId, name } = args as { campaignId: string; name: string };
	try {
		return await getClient(config).ads.cloneCampaign(campaignId, { name });
	} catch (err) {
		return toolErrorEnvelope(err, "ads_campaign_clone_failed", `/v1/ads/${campaignId}/clone`);
	}
}

/* ─── per-ad bid + bulk ops ─── */

export const adsAdBidUpdateInput = Type.Object({
	campaignId: Type.String({ minLength: 1 }),
	adId: Type.String({ minLength: 1 }),
	bidPercentage: Type.String({ minLength: 1 }),
});
export const adsAdBidUpdateDescription =
	'Update one ad\'s bid percentage. Calls POST /v1/ads/{campaignId}/ads/{adId}/bid. **Inputs** — `campaignId`, `adId`, `bidPercentage` (eBay-format string, e.g. "5.0"). **Output** — empty 204.';
export async function adsAdBidUpdateExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const { campaignId, adId, bidPercentage } = args as { campaignId: string; adId: string; bidPercentage: string };
	try {
		await getClient(config).ads.updateAdBid(campaignId, adId, { bidPercentage });
		return { campaignId, adId, bidPercentage, updated: true };
	} catch (err) {
		return toolErrorEnvelope(err, "ads_ad_bid_update_failed", `/v1/ads/${campaignId}/ads/${adId}/bid`);
	}
}

const bulkRowsInput = Type.Object({
	campaignId: Type.String({ minLength: 1 }),
	requests: Type.Array(Type.Object({ listingId: Type.String(), bidPercentage: Type.Optional(Type.String()) }), {
		minItems: 1,
		maxItems: 500,
	}),
});

export const adsBulkCreateInput = bulkRowsInput;
export const adsBulkCreateDescription =
	"Bulk-create ads in one campaign by listing id (up to 500 per call). Calls POST /v1/ads/{campaignId}/ads/bulk-create. **When to use** — turn 100s of new listings into ads in one round-trip. **Inputs** — `{ campaignId, requests: [{ listingId, bidPercentage? }] }`. **Output** — `{ results: [{ listingId, adId?, status?, errors? }] }` — partial successes are normal; iterate.";
export async function adsBulkCreateExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const { campaignId, requests } = args as {
		campaignId: string;
		requests: Array<{ listingId: string; bidPercentage?: string }>;
	};
	try {
		return await getClient(config).ads.bulkCreateAds(campaignId, { requests });
	} catch (err) {
		return toolErrorEnvelope(err, "ads_bulk_create_failed", `/v1/ads/${campaignId}/ads/bulk-create`);
	}
}

export const adsBulkUpdateBidInput = bulkRowsInput;
export const adsBulkUpdateBidDescription =
	"Bulk-update ad bids by listing id. Calls POST /v1/ads/{campaignId}/ads/bulk-update-bid. **When to use** — re-tune bids across many listings on one campaign at once.";
export async function adsBulkUpdateBidExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const { campaignId, requests } = args as {
		campaignId: string;
		requests: Array<{ listingId: string; bidPercentage?: string }>;
	};
	try {
		return await getClient(config).ads.bulkUpdateAdBids(campaignId, { requests });
	} catch (err) {
		return toolErrorEnvelope(err, "ads_bulk_update_bid_failed", `/v1/ads/${campaignId}/ads/bulk-update-bid`);
	}
}

export const adsBulkDeleteInput = Type.Object({
	campaignId: Type.String({ minLength: 1 }),
	listingIds: Type.Array(Type.String(), { minItems: 1, maxItems: 500 }),
});
export const adsBulkDeleteDescription =
	"Bulk-delete ads by listing id. Calls POST /v1/ads/{campaignId}/ads/bulk-delete. **Inputs** — `{ campaignId, listingIds }`. **Output** — `{ results: [{ listingId, status?, errors? }] }`.";
export async function adsBulkDeleteExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const { campaignId, listingIds } = args as { campaignId: string; listingIds: string[] };
	try {
		return await getClient(config).ads.bulkDeleteAds(campaignId, { listingIds });
	} catch (err) {
		return toolErrorEnvelope(err, "ads_bulk_delete_failed", `/v1/ads/${campaignId}/ads/bulk-delete`);
	}
}

export const adsBulkUpdateStatusInput = Type.Object({
	campaignId: Type.String({ minLength: 1 }),
	requests: Type.Array(
		Type.Object({ listingId: Type.String(), adStatus: Type.Union([Type.Literal("ACTIVE"), Type.Literal("PAUSED")]) }),
		{ minItems: 1, maxItems: 500 },
	),
});
export const adsBulkUpdateStatusDescription =
	'Bulk pause/resume ads by listing id. Calls POST /v1/ads/{campaignId}/ads/bulk-update-status. **Inputs** — `{ campaignId, requests: [{ listingId, adStatus: "ACTIVE" | "PAUSED" }] }`.';
export async function adsBulkUpdateStatusExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const { campaignId, requests } = args as {
		campaignId: string;
		requests: Array<{ listingId: string; adStatus: "ACTIVE" | "PAUSED" }>;
	};
	try {
		return await getClient(config).ads.bulkUpdateAdStatus(campaignId, { requests });
	} catch (err) {
		return toolErrorEnvelope(err, "ads_bulk_update_status_failed", `/v1/ads/${campaignId}/ads/bulk-update-status`);
	}
}
