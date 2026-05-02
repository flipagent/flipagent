/**
 * BridgeError → HTTP status mapping. Centralised so every listings
 * composer surfaces bridge transport failures consistently.
 */

import { BridgeError } from "./bridge.js";
import { ListingsError } from "./errors.js";

export function bridgeErrorStatus(err: BridgeError): number {
	if (err.code === "bridge_not_paired") return 412;
	if (err.code === "bridge_timeout") return 504;
	return 502;
}

export function rethrowAsListingsError(err: unknown): never {
	if (err instanceof BridgeError) {
		throw new ListingsError(err.code, bridgeErrorStatus(err), err.message);
	}
	if (err instanceof ListingsError) throw err;
	const msg = err instanceof Error ? err.message : String(err);
	throw new ListingsError("upstream_failed", 502, msg);
}
