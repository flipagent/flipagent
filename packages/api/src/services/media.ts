/**
 * commerce/media — image/video upload prep.
 *
 * Two-step flow: caller POSTs `/v1/media/uploads`, gets back a
 * pre-signed `uploadUrl` + `uploadHeaders`, then PUTs the binary
 * directly to that URL. We don't proxy the binary upload through
 * flipagent — that'd double the bandwidth.
 */

import type { Media, MediaUpload, MediaUploadRequest } from "@flipagent/types";
import { sellRequest, swallowEbay404 } from "./ebay/rest/user-client.js";

interface EbayUpload {
	mediaId: string;
	uploadUrl: string;
	uploadHeaders?: Record<string, string>;
	expirationDate: string;
}

export interface MediaContext {
	apiKeyId: string;
}

export async function createMediaUpload(input: MediaUploadRequest, ctx: MediaContext): Promise<MediaUpload> {
	const path = input.type === "video" ? "/commerce/media/v1_beta/video" : "/commerce/media/v1_beta/image";
	const res = await sellRequest<EbayUpload>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path,
		body: { type: input.type.toUpperCase() },
	});
	return {
		mediaId: res.mediaId,
		uploadUrl: res.uploadUrl,
		uploadHeaders: res.uploadHeaders ?? {},
		expiresAt: res.expirationDate,
	};
}

export async function getMedia(id: string, type: "image" | "video", ctx: MediaContext): Promise<Media | null> {
	const res = await sellRequest<{ status: string; url?: string }>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/commerce/media/v1_beta/${type}/${encodeURIComponent(id)}`,
	}).catch(swallowEbay404);
	return res ? { id, type, ...(res.url ? { url: res.url } : {}), status: res.status } : null;
}
