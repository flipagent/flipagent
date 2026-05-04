/**
 * `/v1/me/{quota,programs}` services — wraps Developer Analytics
 * (`/developer/analytics/v1_beta/{rate_limit,user_rate_limit}`) and
 * Sell Account program enrollment (`/sell/account/v1/program/*`).
 */

import type { MeProgramsResponse, MeQuotaResponse, ProgramOptResponse, QuotaApi } from "@flipagent/types";
import { sellRequest, swallow404 } from "./ebay/rest/user-client.js";

interface UpstreamRate {
	limit?: number;
	remaining?: number;
	reset?: string;
	timeWindow?: number;
}
interface UpstreamRateLimitResource {
	name?: string;
	/** eBay returns one or more rate windows per resource (e.g. daily +
	 *  burst). We surface the smallest-window rate that actually carries
	 *  numbers — that's the one a caller cares about for backoff. */
	rates?: UpstreamRate[];
}
interface UpstreamRateLimit {
	apiContext?: string;
	apiName?: string;
	apiVersion?: string;
	resources?: UpstreamRateLimitResource[];
}
interface UpstreamRateLimitsResponse {
	rateLimits?: UpstreamRateLimit[];
}

function pickRate(rates: UpstreamRate[] | undefined): UpstreamRate | undefined {
	if (!rates || rates.length === 0) return undefined;
	// Prefer rates with concrete numbers; fall back to the first entry.
	return rates.find((r) => r.limit != null || r.remaining != null) ?? rates[0];
}

function toQuotaApis(res: UpstreamRateLimitsResponse | null): QuotaApi[] {
	return (res?.rateLimits ?? []).map((api) => ({
		apiContext: api.apiContext ?? "",
		apiName: api.apiName ?? "",
		apiVersion: api.apiVersion ?? "",
		resources: (api.resources ?? []).map((r) => {
			const rate = pickRate(r.rates);
			return {
				name: r.name ?? "",
				...(rate?.limit != null ? { limit: rate.limit } : {}),
				...(rate?.remaining != null ? { remaining: rate.remaining } : {}),
				...(rate?.reset ? { reset: rate.reset } : {}),
				...(rate?.timeWindow != null ? { timeWindow: rate.timeWindow } : {}),
			};
		}),
	}));
}

export async function getMeQuota(apiKeyId: string): Promise<Omit<MeQuotaResponse, "source">> {
	const [appRes, userRes] = await Promise.all([
		swallow404(
			sellRequest<UpstreamRateLimitsResponse>({
				apiKeyId,
				method: "GET",
				path: "/developer/analytics/v1_beta/rate_limit/",
			}),
		),
		swallow404(
			sellRequest<UpstreamRateLimitsResponse>({
				apiKeyId,
				method: "GET",
				path: "/developer/analytics/v1_beta/user_rate_limit/",
			}),
		),
	]);
	return {
		apiQuota: toQuotaApis(appRes),
		userQuota: toQuotaApis(userRes),
	};
}

interface UpstreamProgramsResponse {
	programs?: Array<{ programType?: string }>;
}

export async function getOptedInPrograms(apiKeyId: string): Promise<Omit<MeProgramsResponse, "source">> {
	const res = await swallow404(
		sellRequest<UpstreamProgramsResponse>({
			apiKeyId,
			method: "GET",
			path: "/sell/account/v1/program/get_opted_in_programs",
		}),
	);
	return {
		programs: (res?.programs ?? []).map((p) => ({ programType: p.programType ?? "" })),
	};
}

export async function optInToProgram(
	apiKeyId: string,
	programType: string,
): Promise<Omit<ProgramOptResponse, "source">> {
	await sellRequest({
		apiKeyId,
		method: "POST",
		path: "/sell/account/v1/program/opt_in",
		body: { programType },
	});
	return { programType, ok: true };
}

export async function optOutOfProgram(
	apiKeyId: string,
	programType: string,
): Promise<Omit<ProgramOptResponse, "source">> {
	await sellRequest({
		apiKeyId,
		method: "POST",
		path: "/sell/account/v1/program/opt_out",
		body: { programType },
	});
	return { programType, ok: true };
}
