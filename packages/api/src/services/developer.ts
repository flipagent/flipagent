/**
 * `/v1/developer/register` — eBay developer/registration self-service.
 *
 * Wraps `/developer/registration/v1/client/register`. App-credential
 * (no user OAuth needed). Returns the new app's client id / app id
 * so a hosting customer can wire their own eBay app without manually
 * filling the dev-portal form.
 */

import type { DeveloperAppRegisterRequest, DeveloperAppRegisterResponse } from "@flipagent/types";
import { appRequest } from "./ebay/rest/app-client.js";

interface EbayRegistrationResponse {
	appId?: string;
	clientId?: string;
}

export async function registerDeveloperApp(input: DeveloperAppRegisterRequest): Promise<DeveloperAppRegisterResponse> {
	const res = await appRequest<EbayRegistrationResponse>({
		method: "POST",
		path: "/developer/registration/v1/client/register",
		body: {
			applicationName: input.applicationName,
			...(input.applicationType ? { applicationType: input.applicationType } : {}),
			...(input.redirectUri ? { redirectUri: input.redirectUri } : {}),
		},
	});
	return {
		...(res?.appId ? { appId: res.appId } : {}),
		...(res?.clientId ? { clientId: res.clientId } : {}),
		raw: res,
	};
}
