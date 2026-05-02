/**
 * `/v1/saved-searches/*` — saved searches (Trading XML).
 */

import type { SavedSearch, SavedSearchCreate } from "@flipagent/types";
import { addSavedSearch, deleteSavedSearch, listSavedSearches } from "./ebay/trading/myebay.js";

export async function fetchSavedSearches(accessToken: string): Promise<SavedSearch[]> {
	return listSavedSearches(accessToken);
}

export async function createSavedSearch(accessToken: string, input: SavedSearchCreate): Promise<SavedSearch> {
	const { id } = await addSavedSearch(accessToken, input);
	return {
		id,
		name: input.name,
		...(input.query ? { query: input.query } : {}),
		...(input.categoryId ? { categoryId: input.categoryId } : {}),
		...(input.filter ? { filter: input.filter } : {}),
		...(input.emailNotifications !== undefined ? { emailNotifications: input.emailNotifications } : {}),
		createdAt: new Date().toISOString(),
	};
}

export async function removeSavedSearch(accessToken: string, id: string): Promise<void> {
	await deleteSavedSearch(accessToken, id);
}
