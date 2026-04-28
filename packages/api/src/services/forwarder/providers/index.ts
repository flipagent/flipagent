export { planetExpress } from "./planet-express.js";

import type { ForwarderProvider } from "../types.js";
import { planetExpress } from "./planet-express.js";

/** All shipped providers, keyed by id. Add new providers via PR. */
export const PROVIDERS: Record<string, ForwarderProvider> = {
	[planetExpress.id]: planetExpress,
};

export function getProvider(id: string): ForwarderProvider {
	const p = PROVIDERS[id];
	if (!p) throw new Error(`Unknown forwarder provider: ${id}. Known: ${Object.keys(PROVIDERS).join(", ")}`);
	return p;
}
