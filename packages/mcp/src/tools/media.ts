/**
 * Media tools — pre-signed image / video upload URLs. Use these to
 * stash listing photos before calling `flipagent_listings_create`
 * (the listing's `images` field expects URLs that flipagent serves).
 */

import { MediaUploadRequest } from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

/* ----------------------- flipagent_media_create_upload ---------------------- */

export { MediaUploadRequest as mediaCreateUploadInput };

export const mediaCreateUploadDescription =
	'Create a pre-signed upload URL for one image or video. POST /v1/media/uploads. Returns `{ uploadUrl, mediaId }`. PUT the bytes to `uploadUrl` (no auth header — the URL is signed); the `mediaId` is what you reference from `flipagent_listings_create` (`images: ["https://media.flipagent.dev/<mediaId>"]`).';

export async function mediaCreateUploadExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.media.createUpload(args as Parameters<typeof client.media.createUpload>[0]);
	} catch (err) {
		const e = toApiCallError(err, "/v1/media/uploads");
		return { error: "media_create_upload_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* --------------------------- flipagent_media_get --------------------------- */

export const mediaGetInput = Type.Object({ mediaId: Type.String({ minLength: 1 }) });

export const mediaGetDescription = "Fetch metadata for one uploaded media item. GET /v1/media/{id}.";

export async function mediaGetExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const id = String(args.mediaId);
	try {
		const client = getClient(config);
		return await client.media.get(id);
	} catch (err) {
		const e = toApiCallError(err, `/v1/media/${id}`);
		return { error: "media_get_failed", status: e.status, url: e.url, message: e.message };
	}
}
