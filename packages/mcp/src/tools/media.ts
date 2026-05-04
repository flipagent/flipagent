/**
 * Media tools — pre-signed image / video upload URLs. Use these to
 * stash listing photos before calling `flipagent_listings_create`
 * (the listing's `images` field expects URLs that flipagent serves).
 */

import { MediaUploadRequest } from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { getClient, toolErrorEnvelope } from "../client.js";
import type { Config } from "../config.js";

/* ----------------------- flipagent_media_create_upload ---------------------- */

export { MediaUploadRequest as mediaCreateUploadInput };

export const mediaCreateUploadDescription =
	'Mint a pre-signed upload URL for one image or video file. Calls POST /v1/media/uploads. **When to use** — required step before `flipagent_create_listing` (eBay needs HTTPS-hosted images, not raw bytes); also handy when handing photos from `flipagent_request_package_photos` to a listing. **Inputs** — `kind: "image" | "video"`, `contentType` (e.g. `image/jpeg`), optional `originalFilename`. **Output** — `{ uploadUrl, mediaId, expiresAt }`. PUT the bytes to `uploadUrl` (no auth header — the URL is signed). Then reference `https://media.flipagent.dev/<mediaId>` in `flipagent_create_listing.images[]`. **Prereqs** — `FLIPAGENT_API_KEY`; no eBay OAuth needed. **Example** — `{ kind: "image", contentType: "image/jpeg", originalFilename: "front.jpg" }`.';

export async function mediaCreateUploadExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.media.createUpload(args as Parameters<typeof client.media.createUpload>[0]);
	} catch (err) {
		return toolErrorEnvelope(err, "media_create_upload_failed", "/v1/media/uploads");
	}
}

/* ------------------ flipagent_upload_image_to_ebay ------------------- */

export const ebayPictureUploadInput = Type.Object({
	sourceUrl: Type.String({
		description:
			"HTTPS URL of the image. flipagent fetches it and forwards to eBay's Picture Hosting in one round-trip. ≤10MB.",
	}),
	extensionInDays: Type.Optional(
		Type.Union([Type.Literal(1), Type.Literal(5), Type.Literal(7), Type.Literal(30), Type.Literal(60)], {
			description: "eBay deletes the picture this many days after the last listing referencing it ends. Default 30.",
		}),
	),
	pictureName: Type.Optional(
		Type.String({ maxLength: 100, description: "Free-text label shown in the seller's eBay Picture Manager." }),
	),
});

export const ebayPictureUploadDescription =
	"Upload an image directly to eBay's Picture Hosting. Calls POST /v1/media/ebay-pictures (Trading API `UploadSiteHostedPictures` under the hood). **When to use** — eBay-only listings where you don't want third-party storage in the path. eBay hosts the image; the returned URL is permanent for the listing's lifetime. For multi-marketplace catalog (Amazon + eBay + Mercari sharing one URL) or permanent product curation, prefer `flipagent_create_media_upload` (flipagent-hosted blob). **Inputs** — `sourceUrl` (any public HTTPS image URL flipagent can fetch), optional `extensionInDays` (1/5/7/30/60), optional `pictureName`. **Output** — `{ fullUrl, memberUrls, extensionInDays }`. Drop `fullUrl` straight into `flipagent_create_listing.images[]`. **Prereqs** — eBay seller account connected. The image must be ≤10MB and a valid type eBay accepts (jpeg/png/gif/bmp/tiff). **Example** — `{ sourceUrl: \"https://photos.example.com/iphone-front.jpg\" }`.";

export async function ebayPictureUploadExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.media.uploadToEbay(args as Parameters<typeof client.media.uploadToEbay>[0]);
	} catch (err) {
		return toolErrorEnvelope(err, "ebay_picture_upload_failed", "/v1/media/ebay-pictures");
	}
}

/* --------------------------- flipagent_media_get --------------------------- */

export const mediaGetInput = Type.Object({ mediaId: Type.String({ minLength: 1 }) });

export const mediaGetDescription =
	'Fetch metadata for one previously-uploaded media item. Calls GET /v1/media/{id}. **When to use** — confirm a PUT-upload finished and the file is hosted; debug missing-image issues on a listing. **Inputs** — `mediaId` (from `flipagent_create_media_upload`). **Output** — `{ id, kind, contentType, sizeBytes, url, uploadedAt? }` — `uploadedAt: null` means the PUT hasn\'t completed. **Prereqs** — `FLIPAGENT_API_KEY`. **Example** — `{ mediaId: "med_abc123" }`.';

export async function mediaGetExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const id = String(args.mediaId);
	try {
		const client = getClient(config);
		return await client.media.get(id);
	} catch (err) {
		return toolErrorEnvelope(err, "media_get_failed", `/v1/media/${id}`);
	}
}
