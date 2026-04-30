/**
 * Map a pipeline error code (any thrown by `runEvaluatePipeline` /
 * `runDiscoverPipeline` — `EvaluateError` codes + `ListingsError`
 * codes — to the right HTTP status for sync routes. Async routes
 * surface the error code/message verbatim on the job row; only sync
 * mode needs to compress that down to a status code.
 */
export function httpStatusForPipelineError(code: string): 400 | 404 | 422 | 500 | 502 | 503 {
	switch (code) {
		case "validation_failed":
		case "invalid_item_id":
			return 400;
		case "item_not_found":
		case "not_found":
			return 404;
		case "no_title":
		case "not_enough_sold":
		case "no_candidates":
			return 422;
		case "search_failed":
		case "upstream_failed":
		case "bridge_timeout":
		case "bridge_failed":
			return 502;
		case "insights_not_approved":
		case "ebay_not_configured":
		case "not_configured":
		case "bridge_not_paired":
			return 503;
		default:
			return 500;
	}
}
