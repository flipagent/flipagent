/**
 * `client.markdowns.*` — item-price markdown campaigns.
 */

import type { PriceMarkdown, PriceMarkdownCreate, PriceMarkdownsListResponse } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface MarkdownsClient {
	list(): Promise<PriceMarkdownsListResponse>;
	create(body: PriceMarkdownCreate): Promise<PriceMarkdown>;
}

export function createMarkdownsClient(http: FlipagentHttp): MarkdownsClient {
	return {
		list: () => http.get("/v1/markdowns"),
		create: (body) => http.post("/v1/markdowns", body),
	};
}
