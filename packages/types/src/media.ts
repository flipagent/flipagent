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
		publicUrl: Type.Optional(Type.String({ description: "Public URL the blob will be reachable at after the PUT (image uploads only)." })),
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
