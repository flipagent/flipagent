import type { Tool, Toolset } from "./registry.js";
import { adminTools } from "./sets/admin.js";
import { commsTools } from "./sets/comms.js";
import { coreTools } from "./sets/core.js";
import { forwarderTools } from "./sets/forwarder.js";
import { notificationsTools } from "./sets/notifications.js";
import { sellerAccountTools } from "./sets/seller-account.js";

export type { Tool, Toolset } from "./registry.js";
export { ALL_TOOLSETS, DEFAULT_TOOLSETS } from "./registry.js";

export const tools: Tool[] = [
	...coreTools,
	...adminTools,
	...commsTools,
	...forwarderTools,
	...sellerAccountTools,
	...notificationsTools,
];

/**
 * Filter the registry by toolsets enabled for this MCP instance.
 * Pass `["*"]` to enable all. Default = `DEFAULT_TOOLSETS`.
 */
export function selectTools(enabled: readonly Toolset[] | readonly ["*"]): Tool[] {
	if (enabled.length === 1 && enabled[0] === "*") return tools;
	const set = new Set(enabled as readonly Toolset[]);
	return tools.filter((t) => set.has(t.toolset));
}
