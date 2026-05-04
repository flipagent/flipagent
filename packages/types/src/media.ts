/**
 * `/v1/media` — image + video upload prep.
 *
 *   POST /v1/media/uploads → uploadUrl (signed) + publicUrl + mediaId
 *   PUT  uploadUrl (binary)  → 201
 *   then use `publicUrl` in the listing's `imageUrls[]`.
 *
 * Image uploads land on flipagent-managed Azure Blob Storage (Azurite
 * for local dev). Video uploads use eBay's commerce/media surface.
 */

import { type Static, Type } from "@sinclair/typebox";
import { ResponseSource } from "./_common.js";

export const MediaType = Type.Union([Type.Literal("image"), Type.Literal("video")], { $id: "MediaType" });
export type MediaType = Static<typeof MediaType>;

export const MediaUpload = Type.Object(
	{
		mediaId: Type.String(),
		uploadUrl: Type.String(),
		uploadHeaders: Type.Record(Type.String(), Type.String()),
		expiresAt: Type.String(),
		publicUrl: Type.Optional(
			Type.String({ description: "Public URL the blob will be reachable at after the PUT (image uploads only)." }),
		),
		source: Type.Optional(ResponseSource),
	},
	{ $id: "MediaUpload" },
);
export type MediaUpload = Static<typeof MediaUpload>;

export const MediaUploadRequest = Type.Object(
	{
		type: MediaType,
		contentType: Type.Optional(
			Type.String({ description: "MIME type the caller will PUT (default: image/jpeg). Image uploads only." }),
		),
	},
	{ $id: "MediaUploadRequest" },
);
export type MediaUploadRequest = Static<typeof MediaUploadRequest>;

/**
 * `POST /v1/media/ebay-pictures` — eBay-direct image upload via Trading
 * API `UploadSiteHostedPictures`. One round-trip: caller POSTs binary,
 * server wraps in multipart + forwards to eBay, returns the
 * `https://i.ebayimg.com/...` URL ready to drop into a listing's
 * `imageUrls[]`.
 *
 * Sibling of the blob path (`POST /v1/media/uploads`):
 *   - blob   = caller hosts on flipagent's storage. Multi-marketplace
 *              reuse, permanent. Use for catalog / cross-platform.
 *   - ebay   = eBay hosts. eBay-only, evicts after the listing ends + a
 *              grace window. Use for one-off eBay listings where you
 *              don't want third-party storage in the path.
 *
 * Auth: api key (the route resolves the seller's IAF token internally).
 */
export const EbayPictureUploadRequest = Type.Object(
	{
		/** Public URL flipagent fetches the image from before forwarding to eBay. Caller-supplied so we don't have to handle binary upload over MCP. */
		sourceUrl: Type.String({
			format: "uri",
			description: "HTTPS URL of the image. flipagent fetches → forwards to eBay's Picture Hosting.",
		}),
		/** 1, 5, 7, 30, 60. eBay deletes the picture this many days after the last listing referencing it ends. Default 30. */
		extensionInDays: Type.Optional(
			Type.Union([Type.Literal(1), Type.Literal(5), Type.Literal(7), Type.Literal(30), Type.Literal(60)]),
		),
		/** Free-text label shown in the seller's eBay Picture Manager. */
		pictureName: Type.Optional(Type.String({ maxLength: 100 })),
	},
	{ $id: "EbayPictureUploadRequest" },
);
export type EbayPictureUploadRequest = Static<typeof EbayPictureUploadRequest>;

export const EbayPictureUploadResponse = Type.Object(
	{
		fullUrl: Type.String({ description: "Stable `https://i.ebayimg.com/...` URL. Use as-is in `imageUrls[]`." }),
		memberUrls: Type.Array(Type.String(), {
			description: "Secondary URLs (different sizes — thumbnails, supersize).",
		}),
		extensionInDays: Type.Integer(),
	},
	{ $id: "EbayPictureUploadResponse" },
);
export type EbayPictureUploadResponse = Static<typeof EbayPictureUploadResponse>;

export const Media = Type.Object(
	{
		id: Type.String(),
		type: MediaType,
		url: Type.Optional(Type.String()),
		status: Type.String({ description: "READY | PROCESSING | FAILED | …" }),
		source: Type.Optional(ResponseSource),
	},
	{ $id: "Media" },
);
export type Media = Static<typeof Media>;
