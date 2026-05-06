import { FormatRegistry } from "@sinclair/typebox";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { getAuth } from "./auth/better-auth.js";
import { config } from "./config.js";
import { registerOpenApi } from "./openapi-spec.js";
import { healthRoute } from "./routes/health.js";
import { mcpRoute } from "./routes/mcp.js";
import { rootRoute } from "./routes/root.js";
import { v1Routes } from "./routes/v1/index.js";
import { EbayApiError } from "./services/ebay/rest/user-client.js";
import { TradingApiError } from "./services/ebay/trading/client.js";
import { PurchaseError } from "./services/purchases/orchestrate.js";
import { nextAction } from "./services/shared/next-action.js";

// Register TypeBox formats used in @flipagent/types schemas.
// Without this, `Type.String({ format: "<x>" })` validation passes any string —
// or worse, *fails* every value when an unknown format is referenced.
FormatRegistry.Set("email", (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v));
FormatRegistry.Set("uuid", (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v));
FormatRegistry.Set("uri", (v) => /^https?:\/\/[^\s]{4,}$/i.test(v));
FormatRegistry.Set("date-time", (v) => !Number.isNaN(Date.parse(v)));

export const app = new Hono();

app.use("*", logger());

// Single CORS middleware. We can't use `origin: "*"` because the dashboard
// flow (/api/auth/*, /v1/me/*) needs `credentials: true`, and the browser
// rejects ACAO=* with credentials. Echo back the request origin instead —
// safer than wildcard, and agent traffic (X-API-Key) doesn't care about
// the value either way.
app.use(
	"*",
	cors({
		origin: (origin) => origin ?? config.APP_URL,
		credentials: true,
		allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
		// `Accept` is included for SSE callers (`/v1/agent/chat` with
		// `Accept: text/event-stream`). Most browsers safelist Accept
		// for simple values, but treat custom values like
		// `text/event-stream` as non-safelisted, triggering a preflight
		// rejection without an explicit allow.
		allowHeaders: ["Content-Type", "Authorization", "X-API-Key", "Accept"],
		exposeHeaders: [
			"X-RateLimit-Limit",
			"X-RateLimit-Remaining",
			"X-RateLimit-Reset",
			"X-Flipagent-Source",
			"X-Flipagent-From-Cache",
			"X-Flipagent-Cached-At",
		],
	}),
);

// Better-Auth handler — handles GitHub OAuth start/callback, session,
// sign-out. When BETTER_AUTH_SECRET / GITHUB_CLIENT_ID are unset, this
// returns 503 so the rest of the api keeps running.
app.all("/api/auth/*", async (c) => {
	const auth = getAuth();
	if (!auth) {
		return c.json({ error: "auth_not_configured", message: "GitHub OAuth env vars not set." }, 503);
	}
	return auth.handler(c.req.raw);
});

app.route("/", rootRoute);
app.route("/healthz", healthRoute);
// `/mcp` — same tool catalog as the stdio binary, served over the MCP
// streamable HTTP transport. Mounted at root (not `/v1/mcp`) to match
// the Model Context Protocol spec. Used by OpenAI's Responses API
// native MCP integration to drive the agent surface.
app.route("/mcp", mcpRoute);
app.route("/v1", v1Routes);

registerOpenApi(app);

app.notFound((c) => c.json({ error: "not_found", path: c.req.path }, 404));

app.onError((err, c) => {
	// Known typed errors map to typed responses with optional next_action.
	// Routes that catch these manually (purchases, sales, listings) return
	// their own c.json before reaching here; the rest fall through and we
	// avoid the 500 internal_error fallback for OAuth/config misses.
	if (err instanceof EbayApiError) {
		const next_action = err.nextActionKind ? nextAction(c, err.nextActionKind) : undefined;
		const ebayErrors = extractUpstreamErrors(err.upstream);
		if (ebayErrors) console.error("[ebay]", err.status, err.code, JSON.stringify(ebayErrors));
		return c.json(
			{
				error: err.code,
				message: err.message,
				...(ebayErrors ? { ebay_errors: ebayErrors } : {}),
				...(next_action ? { next_action } : {}),
			},
			err.status as 401 | 403 | 404 | 412 | 502 | 503,
		);
	}
	if (err instanceof PurchaseError) {
		return c.json({ error: err.code, message: err.message }, err.status as 400 | 401 | 404 | 412 | 502);
	}
	if (err instanceof TradingApiError) {
		return c.json({ error: "trading_call_failed", callName: err.callName, errors: err.errors }, 502);
	}
	console.error("[api]", err);
	return c.json({ error: "internal_error", message: err.message }, 500);
});

interface UpstreamEbayError {
	errorId?: number;
	domain?: string;
	category?: string;
	message?: string;
	longMessage?: string;
	parameters?: unknown;
}

function extractUpstreamErrors(upstream: unknown): UpstreamEbayError[] | undefined {
	if (!upstream || typeof upstream !== "object") return undefined;
	const u = upstream as { errors?: unknown; errorId?: number; message?: string; longMessage?: string };
	if (Array.isArray(u.errors) && u.errors.length > 0) return u.errors as UpstreamEbayError[];
	if (u.errorId != null || u.message) return [u as UpstreamEbayError];
	return undefined;
}
