/**
 * sell/inventory/v1/location — merchant location CRUD.
 */

import type { Location, LocationCreate, LocationStatus } from "@flipagent/types";
import { sellRequest, swallowEbay404 } from "./ebay/rest/user-client.js";

interface EbayLocation {
	merchantLocationKey: string;
	name?: string;
	phone?: string;
	location: {
		address: {
			addressLine1?: string;
			addressLine2?: string;
			city?: string;
			stateOrProvince?: string;
			postalCode?: string;
			country?: string;
		};
	};
	locationTypes?: string[];
	merchantLocationStatus?: string;
	operatingHours?: Array<{ dayOfWeekEnum: string; intervals: Array<{ open: string; close: string }> }>;
	specialHours?: Array<{ date: string; intervals: Array<{ open: string; close: string }> }>;
	locationInstructions?: string;
}

function ebayToFlipagent(e: EbayLocation): Location {
	const a = e.location.address;
	const status: LocationStatus = e.merchantLocationStatus === "ENABLED" ? "enabled" : "disabled";
	return {
		id: e.merchantLocationKey,
		...(e.name ? { name: e.name } : {}),
		...(e.phone ? { phone: e.phone } : {}),
		address: {
			line1: a.addressLine1 ?? "",
			...(a.addressLine2 ? { line2: a.addressLine2 } : {}),
			city: a.city ?? "",
			...(a.stateOrProvince ? { region: a.stateOrProvince } : {}),
			postalCode: a.postalCode ?? "",
			country: a.country ?? "US",
		},
		...(e.locationTypes ? { locationTypes: e.locationTypes } : {}),
		status,
		...(e.operatingHours ? { hours: e.operatingHours } : {}),
		...(e.specialHours ? { specialHours: e.specialHours } : {}),
		...(e.locationInstructions ? { instructions: e.locationInstructions } : {}),
	};
}

export interface LocationsContext {
	apiKeyId: string;
}

export async function listLocations(ctx: LocationsContext): Promise<{ locations: Location[] }> {
	const res = await sellRequest<{ locations?: EbayLocation[] }>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: "/sell/inventory/v1/location",
	}).catch(swallowEbay404);
	return { locations: (res?.locations ?? []).map(ebayToFlipagent) };
}

export async function getLocation(id: string, ctx: LocationsContext): Promise<Location | null> {
	const res = await sellRequest<EbayLocation>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/sell/inventory/v1/location/${encodeURIComponent(id)}`,
	}).catch(swallowEbay404);
	return res ? ebayToFlipagent(res) : null;
}

export async function createLocation(
	id: string,
	input: LocationCreate,
	ctx: LocationsContext,
): Promise<Location | null> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/sell/inventory/v1/location/${encodeURIComponent(id)}`,
		body: {
			...(input.name ? { name: input.name } : {}),
			...(input.phone ? { phone: input.phone } : {}),
			location: {
				address: {
					addressLine1: input.address.line1,
					...(input.address.line2 ? { addressLine2: input.address.line2 } : {}),
					city: input.address.city,
					...(input.address.region ? { stateOrProvince: input.address.region } : {}),
					postalCode: input.address.postalCode,
					country: input.address.country,
				},
			},
			// eBay accepts only the uppercase enum (`WAREHOUSE`, `STORE`).
			// Normalize at this boundary so callers can be case-insensitive.
			...(input.locationTypes ? { locationTypes: input.locationTypes.map((t) => t.toUpperCase()) } : {}),
			...(input.instructions ? { locationInstructions: input.instructions } : {}),
			merchantLocationStatus: "ENABLED",
		},
		contentLanguage: "en-US",
	});
	return getLocation(id, ctx);
}

export async function deleteLocation(id: string, ctx: LocationsContext): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "DELETE",
		path: `/sell/inventory/v1/location/${encodeURIComponent(id)}`,
	});
}

export async function setLocationStatus(id: string, enabled: boolean, ctx: LocationsContext): Promise<Location | null> {
	const action = enabled ? "enable" : "disable";
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/sell/inventory/v1/location/${encodeURIComponent(id)}/${action}`,
	});
	return getLocation(id, ctx);
}

/**
 * Patch one or more fields of an existing inventory location WITHOUT
 * fully replacing it (the way `createLocation` PUT does). eBay's
 * `update_location_details` accepts a partial `InventoryLocation`
 * shape — only the supplied fields change. Useful for e.g. moving a
 * warehouse without re-entering operating hours.
 *
 * Body shape per OAS3 `InventoryLocation` (only top-level fields we
 * map; the wrapper passes through all eBay knows about):
 *   { name?, phone?, location?: { address?, geoCoordinates? },
 *     locationTypes?, locationInstructions?, locationAdditionalInformation?,
 *     locationWebUrl?, operatingHours?, specialHours?, timeZoneId?,
 *     fulfillmentCenterSpecifications? }
 */
export async function updateLocationDetails(
	id: string,
	patch: Partial<LocationCreate> & {
		instructions?: string;
		additionalInformation?: string;
		webUrl?: string;
		timeZoneId?: string;
		hours?: Array<{ dayOfWeekEnum: string; intervals: Array<{ open: string; close: string }> }>;
		specialHours?: Array<{ date: string; intervals: Array<{ open: string; close: string }> }>;
	},
	ctx: LocationsContext,
): Promise<Location | null> {
	const body: Record<string, unknown> = {};
	if (patch.name) body.name = patch.name;
	if (patch.phone) body.phone = patch.phone;
	if (patch.address) {
		body.location = {
			address: {
				addressLine1: patch.address.line1,
				...(patch.address.line2 ? { addressLine2: patch.address.line2 } : {}),
				city: patch.address.city,
				...(patch.address.region ? { stateOrProvince: patch.address.region } : {}),
				postalCode: patch.address.postalCode,
				country: patch.address.country,
			},
		};
	}
	if (patch.locationTypes) body.locationTypes = patch.locationTypes;
	if (patch.instructions) body.locationInstructions = patch.instructions;
	if (patch.additionalInformation) body.locationAdditionalInformation = patch.additionalInformation;
	if (patch.webUrl) body.locationWebUrl = patch.webUrl;
	if (patch.timeZoneId) body.timeZoneId = patch.timeZoneId;
	if (patch.hours) body.operatingHours = patch.hours;
	if (patch.specialHours) body.specialHours = patch.specialHours;
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/sell/inventory/v1/location/${encodeURIComponent(id)}/update_location_details`,
		body,
		contentLanguage: "en-US",
	});
	return getLocation(id, ctx);
}
