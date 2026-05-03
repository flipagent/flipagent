/**
 * `client.me.*` — caller-side reads (quota, programs).
 * Selling/buying overviews are accessed via the routes directly today;
 * this namespace covers the API-key-auth REST surface.
 */

import type { MeProgramsResponse, MeQuotaResponse, ProgramOptRequest, ProgramOptResponse } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface MeClient {
	quota(): Promise<MeQuotaResponse>;
	listPrograms(): Promise<MeProgramsResponse>;
	optInProgram(body: ProgramOptRequest): Promise<ProgramOptResponse>;
	optOutProgram(body: ProgramOptRequest): Promise<ProgramOptResponse>;
}

export function createMeClient(http: FlipagentHttp): MeClient {
	return {
		quota: () => http.get("/v1/me/quota"),
		listPrograms: () => http.get("/v1/me/programs"),
		optInProgram: (body) => http.post("/v1/me/programs/opt-in", body),
		optOutProgram: (body) => http.post("/v1/me/programs/opt-out", body),
	};
}
