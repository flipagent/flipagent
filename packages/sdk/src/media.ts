/**
 * `client.media.*` — pre-signed image / video upload URLs.
 */

import type { EbayPictureUploadRequest, EbayPictureUploadResponse, Media, MediaUploadRequest } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface MediaClient {
	createUpload(body: MediaUploadRequest): Promise<{ uploadUrl: string; mediaId: string }>;
	uploadToEbay(body: EbayPictureUploadRequest): Promise<EbayPictureUploadResponse>;
	get(id: string): Promise<Media>;
}

export function createMediaClient(http: FlipagentHttp): MediaClient {
	return {
		createUpload: (body) => http.post("/v1/media/uploads", body),
		uploadToEbay: (body) => http.post("/v1/media/ebay-pictures", body),
		get: (id) => http.get(`/v1/media/${encodeURIComponent(id)}`),
	};
}
