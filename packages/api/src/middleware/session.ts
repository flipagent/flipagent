/**
 * requireSession — session-cookie auth (Better-Auth) for the /v1/me/*
 * dashboard surface. Distinct from requireApiKey, which authenticates
 * agent traffic via X-API-Key / Authorization: Bearer for /buy/*.
 */

import { createMiddleware } from "hono/factory";
import { getAuth } from "../auth/better-auth.js";
import type { Session, User } from "../db/schema.js";

declare module "hono" {
	interface ContextVariableMap {
		user: User;
		session: Session;
	}
}

export const requireSession = createMiddleware(async (c, next) => {
	const auth = getAuth();
	if (!auth) {
		return c.json({ error: "auth_not_configured", message: "Auth env vars not set on this api instance." }, 503);
	}
	const result = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!result?.session || !result.user) {
		return c.json({ error: "unauthenticated", message: "Sign in at /signup." }, 401);
	}
	c.set("user", result.user as unknown as User);
	c.set("session", result.session as unknown as Session);
	await next();
});
