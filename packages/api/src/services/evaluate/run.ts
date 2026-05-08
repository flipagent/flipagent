/**
 * `/v1/evaluate` pipeline. Universal Product/listing intelligence.
 *
 *   ProductRef (id | external | query)
 *     → resolveProductRef → flipagent Product (auto-create on miss)
 *     → fetchMarketView   → cross-marketplace MarketView digest
 *     → scoreFromDigest   → buy-decision overlay (only when ref carries
 *                            a specific listing — `kind: "external"`)
 *
 * Two questions, one route:
 *   - `evaluation: null`  → "what's this product worth"
 *   - `evaluation: {…}`   → "should I buy this listing"
 *
 * The MarketView is cached cross-user at the product level — two eBay
 * listings of the same SKU share the digest. Per-user scoring (forwarder,
 * minNet) runs on top of every call, never cached cross-user.
 */

import type { EvaluateResponse } from "@flipagent/types";
import type { ItemDetail, ItemSummary } from "@flipagent/types/ebay/buy";
import type { ApiKey } from "../../db/schema.js";
import { getItemDetail } from "../items/detail.js";
import { searchActiveListings } from "../items/search.js";
import { fetchMarketView } from "../market-data/index.js";
import { EvaluateError, type PipelineListener } from "../market-data/pipeline.js";
import { type ProductRefInput, resolveProductRef } from "../products/index.js";
import { scoreFromDigest } from "./score.js";
import type { EvaluateOptions } from "./types.js";

export type { PipelineEvent, PipelineListener, StepRequestInfo } from "../market-data/pipeline.js";
export { EvaluateError, wasEmittedAsStep } from "../market-data/pipeline.js";

export interface RunEvaluateInput {
	ref: ProductRefInput;
	lookbackDays?: number;
	soldLimit?: number;
	apiKey?: ApiKey;
	opts?: EvaluateOptions;
	onStep?: PipelineListener;
	cancelCheck?: () => Promise<void>;
	jobId?: string;
}

export type RunEvaluateResult = EvaluateResponse;

const DEFAULT_MARKETPLACE = "ebay_us";

export async function runEvaluatePipeline(input: RunEvaluateInput): Promise<RunEvaluateResult> {
	const { ref, lookbackDays = 90, soldLimit = 50, apiKey, opts, onStep, cancelCheck, jobId } = input;

	if (cancelCheck) await cancelCheck();
	const resolved = await resolveProductRef(ref, { apiKey });
	if (resolved.outcome === "ambiguous") {
		throw new EvaluateError(
			"item_not_found",
			404,
			'Multiple plausible products matched. Re-call with `kind: "id"` once you\'ve picked one.',
		);
	}
	if (!resolved.product) {
		throw new EvaluateError("item_not_found", 404, "Could not resolve product.");
	}

	// `external` mode carries the anchor detail back from the resolver
	// (the listing the caller pointed at). For `id` / `query` modes we
	// pick an anchor via marketplace search keyed on the product title —
	// the matcher needs a seed regardless of how the caller named the
	// product.
	let anchorDetail: ItemDetail | null = resolved.anchorDetail ?? null;
	if (!anchorDetail) {
		anchorDetail = await pickAnchorFromTitle(resolved.product.title, apiKey);
		if (!anchorDetail) {
			throw new EvaluateError(
				"no_market",
				404,
				`No active marketplace listings found for product "${resolved.product.title}".`,
			);
		}
	}

	if (cancelCheck) await cancelCheck();

	const digest = await fetchMarketView({
		product: resolved.product,
		variant: resolved.variant ?? null,
		anchorDetail,
		marketplace: DEFAULT_MARKETPLACE,
		lookbackDays,
		soldLimit,
		apiKey,
		jobId,
		onStep,
		cancelCheck,
	});

	// Buy-decision overlay only fires when the caller pointed at a
	// specific listing (`external` ref). For `query` / `id` inputs the
	// "anchor" was synthesised from a title search — scoring it would
	// be a lie (the seller / price weren't what the caller asked about).
	let evaluation: unknown = null;
	let evaluationAll: unknown = null;
	if (ref.kind === "external") {
		const scored = await scoreFromDigest({
			digest,
			opts: { ...opts, lookbackDays },
			ref,
			onStep,
			cancelCheck,
		});
		evaluation = scored.evaluation;
		evaluationAll = scored.evaluationAll;
	}

	return {
		product: toWireProduct(resolved.product),
		variant: resolved.variant ? toWireVariant(resolved.variant) : null,
		anchor: anchorDetail,
		evaluation: evaluation as EvaluateResponse["evaluation"],
		evaluationAll: evaluationAll as EvaluateResponse["evaluationAll"],
		market: digest.market as EvaluateResponse["market"],
		sold: digest.sold as EvaluateResponse["sold"],
		active: digest.active as EvaluateResponse["active"],
		marketAll: digest.marketAll as EvaluateResponse["marketAll"],
		soldAll: digest.soldAll as EvaluateResponse["soldAll"],
		activeAll: digest.activeAll as EvaluateResponse["activeAll"],
		filter: digest.filter as EvaluateResponse["filter"],
		returns: digest.returns as EvaluateResponse["returns"],
		byCondition: digest.byCondition as EvaluateResponse["byCondition"],
		byVariant: digest.byVariant as EvaluateResponse["byVariant"],
		listingFloor: digest.listingFloor as EvaluateResponse["listingFloor"],
		...(digest.headlineConditionTier ? { headlineConditionTier: digest.headlineConditionTier } : {}),
		meta: digest.meta as EvaluateResponse["meta"],
		soldPool: digest.matchedSold,
		activePool: digest.matchedActive,
		rejectedSoldPool: digest.rejectedSold,
		rejectedActivePool: digest.rejectedActive,
		rejectionReasons: digest.rejectionReasons,
		rejectionCategories: digest.rejectionCategories,
		suspiciousIds: digest.suspiciousIds,
	} as EvaluateResponse;
}

async function pickAnchorFromTitle(title: string, apiKey: ApiKey | undefined): Promise<ItemDetail | null> {
	const search = await searchActiveListings({ q: title, limit: 5 }, { apiKey });
	const top = search.body.itemSummaries?.find((it: ItemSummary) => !!it.title?.trim() && !!it.legacyItemId);
	if (!top || !top.legacyItemId) return null;
	const detail = await getItemDetail(top.legacyItemId, { apiKey });
	return detail?.body ?? null;
}

function toWireProduct(row: import("../../db/schema.js").Product): EvaluateResponse["product"] {
	return {
		id: row.id,
		title: row.title,
		brand: row.brand ?? undefined,
		modelNumber: row.modelNumber ?? undefined,
		categoryPath: row.categoryPath ?? undefined,
		catalogStatus: row.catalogStatus as "curated" | "auto" | "pending",
		attributes: row.attributes as Record<string, unknown>,
		hasVariants: row.hasVariants,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

function toWireVariant(row: import("../../db/schema.js").ProductVariant): NonNullable<EvaluateResponse["variant"]> {
	return {
		id: row.id,
		productId: row.productId,
		variantKey: row.variantKey,
		attributes: row.attributes as Record<string, string>,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}
