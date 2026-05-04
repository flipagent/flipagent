/**
 * developer/key_management — signing-key CRUD for the eBay Trust API
 * Digital Signatures requirement (mandatory for some 2025+ endpoints
 * like /sell/finances payouts and /sell/payment-dispute writes).
 *
 * eBay generates an asymmetric ed25519 keypair on the seller's behalf
 * server-side; we POST to mint, GET to read public key + metadata.
 * Used by the api at sign-time to produce the
 * `Signature` / `Signature-Input` headers eBay validates per
 * RFC 9421 (HTTP Message Signatures). Today flipagent doesn't sign any
 * outgoing requests yet — these wrappers exist so we can mint + manage
 * the keys ahead of the eBay endpoints flipping to mandatory.
 */

import { sellRequest, sellRequestWithLocation, swallowEbay404 } from "./ebay/rest/user-client.js";

export interface SigningKeyContext {
	apiKeyId: string;
}

export interface SigningKey {
	id: string;
	publicKey?: string;
	algorithm?: string;
	createdAt?: string;
	expiresAt?: string;
}

interface UpstreamSigningKey {
	signingKeyId?: string;
	publicKey?: string;
	signingKeyCipher?: string;
	createdAt?: string;
	expiresAt?: string;
}

export async function listSigningKeys(ctx: SigningKeyContext): Promise<{ keys: SigningKey[] }> {
	const res = await sellRequest<{ signingKeys?: UpstreamSigningKey[] }>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: "/developer/key_management/v1/signing_key",
	}).catch(swallowEbay404);
	return {
		keys: (res?.signingKeys ?? []).map((k) => ({
			id: k.signingKeyId ?? "",
			...(k.publicKey ? { publicKey: k.publicKey } : {}),
			...(k.signingKeyCipher ? { algorithm: k.signingKeyCipher } : {}),
			...(k.createdAt ? { createdAt: k.createdAt } : {}),
			...(k.expiresAt ? { expiresAt: k.expiresAt } : {}),
		})),
	};
}

export async function getSigningKey(id: string, ctx: SigningKeyContext): Promise<SigningKey | null> {
	const res = await sellRequest<UpstreamSigningKey>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/developer/key_management/v1/signing_key/${encodeURIComponent(id)}`,
	}).catch(swallowEbay404);
	if (!res) return null;
	return {
		id: res.signingKeyId ?? id,
		...(res.publicKey ? { publicKey: res.publicKey } : {}),
		...(res.signingKeyCipher ? { algorithm: res.signingKeyCipher } : {}),
		...(res.createdAt ? { createdAt: res.createdAt } : {}),
		...(res.expiresAt ? { expiresAt: res.expiresAt } : {}),
	};
}

/**
 * Mint a new signing key. eBay generates the keypair server-side;
 * the body specifies which `signingKeyCipher` (ED25519 is the only
 * supported value today). Returns 201 + Location header.
 */
export async function createSigningKey(cipher: "ED25519", ctx: SigningKeyContext): Promise<SigningKey> {
	const { body, locationId } = await sellRequestWithLocation<UpstreamSigningKey>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/developer/key_management/v1/signing_key",
		body: { signingKeyCipher: cipher },
	});
	return {
		id: body?.signingKeyId ?? locationId ?? "",
		...(body?.publicKey ? { publicKey: body.publicKey } : {}),
		algorithm: cipher,
		...(body?.createdAt ? { createdAt: body.createdAt } : {}),
		...(body?.expiresAt ? { expiresAt: body.expiresAt } : {}),
	};
}
