/**
 * requireSession — session-cookie auth (Better-Auth) for the /v1/me/*
 * dashboard surface. Distinct from requireApiKey, which authenticates
 * agent traffic via X-API-Key / Authorization: Bearer for /buy/*.
 *
 * As a side effect, the resolved user's `role` is reconciled against
 * `ADMIN_EMAILS` on every request: an email added to the env list gets
 * promoted on its next session call; an email removed gets demoted.
 * Idempotent — only writes when the persisted role drifts from what
 * the env says it should be.
 */

import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { getAuth } from "../auth/better-auth.js";
import { isAdminEmail } from "../config.js";
import { db } from "../db/client.js";
import { type Session, type User, user as userTable } from "../db/schema.js";

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
	const sessionUser = result.user as unknown as User;
	const reconciled = await reconcileAdminRole(sessionUser);
	c.set("user", reconciled);
	c.set("session", result.session as unknown as Session);
	await next();
});

/**
 * `requireAdmin` — gate for the `/v1/admin/*` surface. Layered on top
 * of `requireSession`: re-resolves the session, then 403s if the
 * user's persisted role isn't `admin`. Mount with
 * `route.use("*", requireAdmin)` exactly the same way as
 * `requireSession`.
 */
export const requireAdmin = createMiddleware(async (c, next) => {
	const auth = getAuth();
	if (!auth) {
		return c.json({ error: "auth_not_configured", message: "Auth env vars not set on this api instance." }, 503);
	}
	const result = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!result?.session || !result.user) {
		return c.json({ error: "unauthenticated", message: "Sign in at /signup." }, 401);
	}
	const reconciled = await reconcileAdminRole(result.user as unknown as User);
	if (reconciled.role !== "admin") {
		return c.json({ error: "forbidden", message: "Admin role required." }, 403);
	}
	c.set("user", reconciled);
	c.set("session", result.session as unknown as Session);
	await next();
});

async function reconcileAdminRole(u: User): Promise<User> {
	const expected = isAdminEmail(u.email) ? "admin" : "user";
	if (u.role === expected) return u;
	await db.update(userTable).set({ role: expected }).where(eq(userTable.id, u.id));
	return { ...u, role: expected };
}
