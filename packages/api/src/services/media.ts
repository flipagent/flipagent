/**
 * `/v1/media` — image + video upload prep.
 *
 * **Image** — flipagent-hosted (Azure Blob today; Azurite for local dev).
 *   Two-step flow: caller POSTs `/v1/media/uploads` and gets back a
 *   short-lived signed `uploadUrl` plus the long-lived `publicUrl` the
 *   blob will be reachable at after the PUT. Use `publicUrl` in the
 *   listing's `imageUrls[]`.
 *
 * **Video** — eBay's `commerce/media/v1_beta` returns the upload URL.
 *   Same shape on our side; the binary still PUTs directly to eBay.
 *
 * We never proxy the binary upload through flipagent — that would
 * double the bandwidth.
 */

import type { Media, MediaUpload, MediaUploadRequest } from "@flipagent/types";
import { loadAzureBlobClient } from "./blob/azure.js";
import { type BlobClient, BlobNotConfiguredError } from "./blob/client.js";
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

let cachedBlobClient: BlobClient | null | undefined;
function getBlobClient(): BlobClient | null {
	if (cachedBlobClient === undefined) {
		cachedBlobClient = loadAzureBlobClient();
	}
	return cachedBlobClient;
}

/** For tests — let suites stub the client without re-importing. */
export function setBlobClientForTesting(client: BlobClient | null): void {
	cachedBlobClient = client;
}

const DEFAULT_IMAGE_CONTENT_TYPE = "image/jpeg";
const EXT_FROM_CONTENT_TYPE: Record<string, string> = {
	"image/jpeg": "jpg",
	"image/jpg": "jpg",
	"image/png": "png",
	"image/webp": "webp",
	"image/gif": "gif",
};

export async function createMediaUpload(input: MediaUploadRequest, ctx: MediaContext): Promise<MediaUpload> {
	if (input.type === "image") {
		const client = getBlobClient();
		if (!client) {
			throw new BlobNotConfiguredError(
				"Image hosting is not configured. Set BLOB_CONNECTION_STRING (Azurite for local dev, Azure Blob Storage in production).",
			);
		}
		const contentType = input.contentType ?? DEFAULT_IMAGE_CONTENT_TYPE;
		const ext = EXT_FROM_CONTENT_TYPE[contentType.toLowerCase()];
		const upload = await client.createUploadUrl({
			contentType,
			...(ext !== undefined ? { ext } : {}),
			prefix: "media/image",
		});
		return {
			mediaId: upload.mediaId,
			uploadUrl: upload.uploadUrl,
			uploadHeaders: upload.uploadHeaders,
			expiresAt: upload.expiresAt,
			publicUrl: upload.publicUrl,
		};
	}

	const res = await sellRequest<EbayUpload>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/commerce/media/v1_beta/video",
		body: { type: "VIDEO" },
	});
	return {
		mediaId: res.mediaId,
		uploadUrl: res.uploadUrl,
		uploadHeaders: res.uploadHeaders ?? {},
		expiresAt: res.expirationDate,
	};
}

export async function getMedia(id: string, type: "image" | "video", ctx: MediaContext): Promise<Media | null> {
	if (type === "image") {
		// Images live on flipagent-managed blob storage; status is implicit
		// (URL exists ⇔ blob exists). We don't read-back, just return the
		// canonical public URL.
		const client = getBlobClient();
		if (!client) return null;
		// We don't currently keep a registry of mediaIds (callers track them),
		// so return a synthetic descriptor with the URL pattern. A future
		// Postgres-backed registry can replace this with a real lookup.
		return { id, type, status: "READY" };
	}
	const res = await sellRequest<{ status: string; url?: string }>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/commerce/media/v1_beta/${type}/${encodeURIComponent(id)}`,
	}).catch(swallowEbay404);
	return res ? { id, type, ...(res.url ? { url: res.url } : {}), status: res.status } : null;
}

export { BlobNotConfiguredError };
