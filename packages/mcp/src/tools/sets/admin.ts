import { browserQueryDescription, browserQueryExecute, browserQueryInput } from "../browser-primitives.js";
import {
	locationsDeleteDescription,
	locationsDeleteExecute,
	locationsDeleteInput,
	locationsDisableDescription,
	locationsDisableExecute,
	locationsDisableInput,
	locationsEnableDescription,
	locationsEnableExecute,
	locationsEnableInput,
	locationsGetDescription,
	locationsGetExecute,
	locationsGetInput,
} from "../locations.js";
import type { Tool } from "../registry.js";
import { shipProvidersDescription, shipProvidersExecute, shipProvidersInput } from "../ship-providers.js";

// Ship providers, location detail/delete + state toggles, browser DOM primitive escape hatch.
export const adminTools: Tool[] = [
	{
		name: "flipagent_list_shipping_providers",
		description: shipProvidersDescription,
		inputSchema: shipProvidersInput,
		execute: shipProvidersExecute,
		toolset: "admin",
	},
	{
		name: "flipagent_get_location",
		description: locationsGetDescription,
		inputSchema: locationsGetInput,
		execute: locationsGetExecute,
		toolset: "admin",
	},
	{
		name: "flipagent_delete_location",
		description: locationsDeleteDescription,
		inputSchema: locationsDeleteInput,
		execute: locationsDeleteExecute,
		toolset: "admin",
	},
	{
		name: "flipagent_enable_location",
		description: locationsEnableDescription,
		inputSchema: locationsEnableInput,
		execute: locationsEnableExecute,
		toolset: "admin",
	},
	{
		name: "flipagent_disable_location",
		description: locationsDisableDescription,
		inputSchema: locationsDisableInput,
		execute: locationsDisableExecute,
		toolset: "admin",
	},
	{
		name: "flipagent_query_browser",
		description: browserQueryDescription,
		inputSchema: browserQueryInput,
		execute: browserQueryExecute,
		toolset: "admin",
	},
];
