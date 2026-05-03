/**
 * Azure Blob Storage adapter.
 *
 * Works against:
 *   - **Azurite** (local dev / docker-compose) — uses the well-known
 *     `devstoreaccount1` connection string.
 *   - **Azure Blob Storage** (production) — Terraform-managed storage
 *     account; container has anonymous-blob (read-only) public access
 *     so the long-lived `publicUrl` is reachable by eBay's image
 *     fetcher when used in `imageUrls[]`.
 *
 * Uploads use a per-blob SAS URL valid for 30 minutes with `cw`
 * (create + write). The caller PUTs the binary directly to that URL
 * with `x-ms-blob-type: BlockBlob` + `Content-Type` headers; we never
 * proxy the bytes through flipagent.
 */

import { randomUUID } from "node:crypto";
import {
	BlobSASPermissions,
	BlobServiceClient,
	type ContainerClient,
	generateBlobSASQueryParameters,
	StorageSharedKeyCredential,
} from "@azure/storage-blob";
import { type BlobClient, BlobNotConfiguredError, type BlobUploadInput, type BlobUploadResult } from "./client.js";

interface AzureConfig {
	connectionString: string;
	containerName: string;
}

/**
 * Pin the SAS signed-version. The control-plane requests use the SDK's
 * default `x-ms-version`; if you target an older Azurite, run it with
 * `--skipApiVersionCheck` (docker-compose already passes that). Pinning
 * the SAS specifically keeps the signature stable + small.
 */
const PINNED_SERVICE_VERSION = "2024-08-04";

/** Pull the account name + key out of a connection string for SAS signing. */
function parseConnectionString(cs: string): { name: string; key: string } | null {
	const parts = cs
		.split(";")
		.map((s) => s.trim())
		.filter(Boolean);
	let name = "";
	let key = "";
	for (const p of parts) {
		const eq = p.indexOf("=");
		if (eq < 0) continue;
		const k = p.slice(0, eq);
		const v = p.slice(eq + 1);
		if (k === "AccountName") name = v;
		else if (k === "AccountKey") key = v;
	}
	if (!name || !key) return null;
	return { name, key };
}

export class AzureBlobClient implements BlobClient {
	private readonly container: ContainerClient;
	private readonly sharedKey: StorageSharedKeyCredential | null;
	private readonly containerName: string;

	constructor(cfg: AzureConfig) {
		const service = BlobServiceClient.fromConnectionString(cfg.connectionString);
		this.container = service.getContainerClient(cfg.containerName);
		this.containerName = cfg.containerName;
		const parsed = parseConnectionString(cfg.connectionString);
		this.sharedKey = parsed ? new StorageSharedKeyCredential(parsed.name, parsed.key) : null;
	}

	/**
	 * Lazily create the container with public-blob access. Idempotent —
	 * boots from a clean Azurite or a pre-provisioned Azure account.
	 */
	private async ensureContainer(): Promise<void> {
		await this.container.createIfNotExists({ access: "blob" });
	}

	async createUploadUrl(input: BlobUploadInput): Promise<BlobUploadResult> {
		if (!this.sharedKey) {
			throw new BlobNotConfiguredError(
				"Azure connection string missing AccountName / AccountKey — managed-identity SAS not yet implemented.",
			);
		}
		await this.ensureContainer();

		const id = randomUUID();
		const ext = input.ext?.replace(/^\.+/, "") ?? "";
		const prefix = input.prefix ? `${input.prefix.replace(/\/+$/, "")}/` : "";
		const blobName = `${prefix}${id}${ext ? `.${ext}` : ""}`;

		const blob = this.container.getBlockBlobClient(blobName);

		const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 min
		const sas = generateBlobSASQueryParameters(
			{
				containerName: this.containerName,
				blobName,
				permissions: BlobSASPermissions.parse("cw"),
				startsOn: new Date(Date.now() - 60 * 1000), // -1 min for clock skew
				expiresOn: expiresAt,
				contentType: input.contentType,
				version: PINNED_SERVICE_VERSION,
			},
			this.sharedKey,
		).toString();

		return {
			mediaId: blobName,
			uploadUrl: `${blob.url}?${sas}`,
			uploadHeaders: {
				"x-ms-blob-type": "BlockBlob",
				"Content-Type": input.contentType,
			},
			expiresAt: expiresAt.toISOString(),
			publicUrl: blob.url,
		};
	}
}

/**
 * Build the blob client from env. Returns `null` when not configured —
 * callers translate that into a 503 + helpful message rather than
 * crashing the route.
 */
export function loadAzureBlobClient(env: NodeJS.ProcessEnv = process.env): AzureBlobClient | null {
	const cs = env.BLOB_CONNECTION_STRING;
	const container = env.BLOB_CONTAINER ?? "media";
	if (!cs) return null;
	return new AzureBlobClient({ connectionString: cs, containerName: container });
}
