/**
 * `/v1/developer` — eBay developer self-service.
 *
 * Wraps eBay's `/developer/registration/v1/client/register` for callers
 * who want to programmatically register an app with eBay (e.g. a
 * white-label platform spinning up sub-tenants). flipagent's primary app
 * is registered manually via the dev portal; this is opt-in for hosting
 * customers.
 */

import { type Static, Type } from "@sinclair/typebox";
import { ResponseSource } from "./_common.js";

export const DeveloperAppRegisterRequest = Type.Object(
	{
		applicationName: Type.String({ description: "Display name shown to eBay users when authorizing." }),
		applicationType: Type.Optional(Type.String({ description: "WEB | NATIVE | …" })),
		redirectUri: Type.Optional(Type.String({ description: "OAuth callback URL (RuName)." })),
	},
	{ $id: "DeveloperAppRegisterRequest" },
);
export type DeveloperAppRegisterRequest = Static<typeof DeveloperAppRegisterRequest>;

export const DeveloperAppRegisterResponse = Type.Object(
	{
		appId: Type.Optional(Type.String()),
		clientId: Type.Optional(Type.String()),
		raw: Type.Optional(Type.Unknown()),
		source: Type.Optional(ResponseSource),
	},
	{ $id: "DeveloperAppRegisterResponse" },
);
export type DeveloperAppRegisterResponse = Static<typeof DeveloperAppRegisterResponse>;
