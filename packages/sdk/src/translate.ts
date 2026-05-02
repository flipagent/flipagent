/**
 * `client.translate.*` — text translation (eBay Commerce Translation API).
 */

import type { TranslateRequest, TranslateResponse } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface TranslateClient {
	translate(body: TranslateRequest): Promise<TranslateResponse>;
}

export function createTranslateClient(http: FlipagentHttp): TranslateClient {
	return {
		translate: (body) => http.post("/v1/translate", body),
	};
}
