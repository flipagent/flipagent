import { FormatRegistry } from "@sinclair/typebox";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { getAuth } from "./auth/better-auth.js";
import { config } from "./config.js";
import { registerOpenApi } from "./openapi.js";
import { healthRoute } from "./routes/health.js";
import { rootRoute } from "./routes/root.js";
import { v1Routes } from "./routes/v1/index.js";

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
		allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization", "X-API-Key"],
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
app.route("/v1", v1Routes);

registerOpenApi(app);

app.notFound((c) => c.json({ error: "not_found", path: c.req.path }, 404));

app.onError((err, c) => {
	console.error("[api]", err);
	return c.json({ error: "internal_error", message: err.message }, 500);
});
