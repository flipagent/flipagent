/**
 * Blob storage abstraction — vendor-agnostic interface for short-lived
 * upload-URL generation + public-URL resolution.
 *
 * Today flipagent runs Azure Blob Storage (and Azurite for local dev).
 * The vendor split (`BLOB_VENDOR=azure`) leaves room for an S3 adapter
 * later without changing call sites.
 */

export interface BlobUploadResult {
	/** Opaque id we hand back to callers; appears in the public URL. */
	mediaId: string;
	/** Short-lived signed URL the caller PUTs binary to. */
	uploadUrl: string;
	/** Required headers when PUTting to `uploadUrl`. */
	uploadHeaders: Record<string, string>;
	/** ISO-8601 timestamp at which `uploadUrl` stops accepting writes. */
	expiresAt: string;
	/** Long-lived public URL the blob will be reachable at after the PUT. */
	publicUrl: string;
}

export interface BlobUploadInput {
	/** MIME type the caller will PUT (eg. `image/jpeg`). */
	contentType: string;
	/** File extension to append to the blob name (eg. `jpg`). Optional. */
	ext?: string;
	/** Logical group used as the path prefix (`media/`, `evidence/`, etc.). */
	prefix?: string;
}

export interface BlobClient {
	createUploadUrl(input: BlobUploadInput): Promise<BlobUploadResult>;
}

/**
 * Thrown when no blob backend is configured. Callers map this to a 503
 * with a helpful next-action so the agent's user knows what to set.
 */
export class BlobNotConfiguredError extends Error {
	readonly code = "blob_not_configured";
	constructor(detail = "Blob storage is not configured. Set BLOB_CONNECTION_STRING.") {
		super(detail);
		this.name = "BlobNotConfiguredError";
	}
}
