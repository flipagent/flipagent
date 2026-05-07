/**
 * Operator surface — `/v1/admin/*`. Session-cookie auth gated by
 * `requireAdmin` (= requireSession + role==='admin'). Bootstrap the
 * first admin by adding an email to `ADMIN_EMAILS` on the api host;
 * Better-Auth's user-create hook + `requireSession` reconcile the
 * `user.role` column on next visit.
 *
 * Surface:
 *   GET    /v1/admin/stats              dashboard counters
 *   GET    /v1/admin/users              search + paginate
 *   GET    /v1/admin/users/:id          full detail (keys + grants + usage)
 *   PATCH  /v1/admin/users/:id          update tier / role
 *   POST   /v1/admin/users/:id/credits  grant credits (or clawback w/ negative)
 *   POST   /v1/admin/users/:id/keys     issue a key on behalf of the user
 *   DELETE /v1/admin/grants/:id         revoke a grant (append-only — never deletes)
 *   DELETE /v1/admin/keys/:id           force-revoke any key
 *
 * Tier and credit changes never touch billing — they're admin
 * overrides, not Stripe subscription mutations. To "give Acme this
 * month free", grant their tier delta in credits or bump the tier
 * directly; Stripe state stays untouched.
 */

import {
	AdminEvaluationList,
	AdminEvaluationListQuery,
	type AdminEvaluationRow,
	AdminGrantCreateRequest,
	AdminGrantRevokeRequest,
	AdminKeyIssueRequest,
	AdminStats,
	AdminUserDetail,
	AdminUserList,
	AdminUserPatchRequest,
	EvaluateResponse,
	KeyCreateResponse,
	KeyRevokeResponse,
} from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, max, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { sendOpsEmail } from "../../auth/email.js";
import { issueKey, revokeKey, type Tier } from "../../auth/keys.js";
import { effectiveTier, snapshotUsage, sumActiveCreditGrants, TIER_LIMITS, usageToWire } from "../../auth/limits.js";
import { config } from "../../config.js";
import { db } from "../../db/client.js";
import {
	apiKeys,
	computeJobs,
	creditGrants,
	listingObservations,
	takedownRequests,
	usageEvents,
	user as userTable,
} from "../../db/schema.js";
import { requireAdmin } from "../../middleware/session.js";
import { legacyFromV1 } from "../../utils/item-id.js";
import { errorResponse, jsonResponse, tbBody, tbCoerce } from "../../utils/openapi.js";

export const adminRoute = new Hono();

adminRoute.use("*", requireAdmin);

const TIERS = ["free", "hobby", "standard", "growth"] as const;

/* --------------------------------- /stats --------------------------------- */

adminRoute.get(
	"/stats",
	describeRoute({
		tags: ["Admin"],
		summary: "High-level operator counters",
		responses: {
			200: jsonResponse("Counters.", AdminStats),
			401: errorResponse("Not signed in."),
			403: errorResponse("Admin role required."),
		},
	}),
	async (c) => {
		const monthCutoff = sql`date_trunc('month', now())`;
		const last30d = sql`now() - interval '30 days'`;

		const [usersByTier, adminsRow, totalUsersRow, signups30dRow, keysRow, grantsRow, usageRow] = await Promise.all([
			db
				.select({ tier: userTable.tier, count: sql<number>`cast(count(*) as int)` })
				.from(userTable)
				.groupBy(userTable.tier),
			db.select({ count: sql<number>`cast(count(*) as int)` }).from(userTable).where(eq(userTable.role, "admin")),
			db.select({ count: sql<number>`cast(count(*) as int)` }).from(userTable),
			db
				.select({ count: sql<number>`cast(count(*) as int)` })
				.from(userTable)
				.where(gte(userTable.createdAt, last30d)),
			db
				.select({
					active: sql<number>`cast(count(*) filter (where ${apiKeys.revokedAt} is null) as int)`,
					revoked: sql<number>`cast(count(*) filter (where ${apiKeys.revokedAt} is not null) as int)`,
				})
				.from(apiKeys),
			db
				.select({
					active: sql<number>`cast(count(*) filter (where ${creditGrants.revokedAt} is null and (${creditGrants.expiresAt} is null or ${creditGrants.expiresAt} > now())) as int)`,
					sumActive: sql<number>`cast(coalesce(sum(${creditGrants.creditsDelta}) filter (where ${creditGrants.revokedAt} is null and (${creditGrants.expiresAt} is null or ${creditGrants.expiresAt} > now())), 0) as int)`,
					last30d: sql<number>`cast(count(*) filter (where ${creditGrants.createdAt} >= now() - interval '30 days') as int)`,
				})
				.from(creditGrants),
			db
				.select({
					calls: sql<number>`cast(count(*) as int)`,
					credits: sql<number>`cast(coalesce(sum(${usageEvents.creditsCharged}), 0) as int)`,
				})
				.from(usageEvents)
				.where(gte(usageEvents.createdAt, monthCutoff)),
		]);

		const byTier = { free: 0, hobby: 0, standard: 0, growth: 0 };
		for (const row of usersByTier) byTier[row.tier as keyof typeof byTier] = row.count;

		return c.json({
			users: {
				total: totalUsersRow[0]?.count ?? 0,
				byTier,
				admins: adminsRow[0]?.count ?? 0,
				signedUpLast30d: signups30dRow[0]?.count ?? 0,
			},
			keys: {
				active: keysRow[0]?.active ?? 0,
				revoked: keysRow[0]?.revoked ?? 0,
			},
			grants: {
				active: grantsRow[0]?.active ?? 0,
				activeBonusCredits: grantsRow[0]?.sumActive ?? 0,
				grantedLast30d: grantsRow[0]?.last30d ?? 0,
			},
			usage: {
				creditsThisMonth: usageRow[0]?.credits ?? 0,
				callsThisMonth: usageRow[0]?.calls ?? 0,
			},
		});
	},
);

/* --------------------------------- /users --------------------------------- */

const ListUsersQuery = Type.Object({
	q: Type.Optional(Type.String()),
	tier: Type.Optional(Type.Union(TIERS.map((t) => Type.Literal(t)))),
	role: Type.Optional(Type.Union([Type.Literal("user"), Type.Literal("admin")])),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
	offset: Type.Optional(Type.Integer({ minimum: 0 })),
});

adminRoute.get(
	"/users",
	describeRoute({
		tags: ["Admin"],
		summary: "Search + paginate users",
		responses: {
			200: jsonResponse("Users.", AdminUserList),
			401: errorResponse("Not signed in."),
			403: errorResponse("Admin role required."),
		},
	}),
	tbCoerce("query", ListUsersQuery),
	async (c) => {
		const q = c.req.valid("query");
		const limit = q.limit ?? 50;
		const offset = q.offset ?? 0;

		const filters = [];
		if (q.q) {
			const like = `%${q.q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
			filters.push(or(ilike(userTable.email, like), ilike(userTable.name, like))!);
		}
		if (q.tier) filters.push(eq(userTable.tier, q.tier));
		if (q.role) filters.push(eq(userTable.role, q.role));
		const where = filters.length > 0 ? and(...filters) : undefined;

		const [rows, totalRow] = await Promise.all([
			db
				.select({
					id: userTable.id,
					email: userTable.email,
					name: userTable.name,
					image: userTable.image,
					tier: userTable.tier,
					role: userTable.role,
					emailVerified: userTable.emailVerified,
					createdAt: userTable.createdAt,
				})
				.from(userTable)
				.where(where)
				.orderBy(desc(userTable.createdAt))
				.limit(limit)
				.offset(offset),
			db.select({ count: count() }).from(userTable).where(where),
		]);

		if (rows.length === 0) {
			return c.json({ users: [], total: totalRow[0]?.count ?? 0, limit, offset });
		}

		const ids = rows.map((r) => r.id);
		// Per-user fanout: active key counts, last activity, bonus credits, monthly credits used.
		const [keyCounts, lastSeen, bonus, used] = await Promise.all([
			db
				.select({
					userId: apiKeys.userId,
					n: sql<number>`cast(count(*) filter (where ${apiKeys.revokedAt} is null) as int)`,
				})
				.from(apiKeys)
				.where(inArray(apiKeys.userId, ids))
				.groupBy(apiKeys.userId),
			db
				.select({ userId: usageEvents.userId, lastAt: max(usageEvents.createdAt) })
				.from(usageEvents)
				.where(inArray(usageEvents.userId, ids))
				.groupBy(usageEvents.userId),
			db
				.select({
					userId: creditGrants.userId,
					sumActive: sql<number>`cast(coalesce(sum(${creditGrants.creditsDelta}) filter (where ${creditGrants.revokedAt} is null and (${creditGrants.expiresAt} is null or ${creditGrants.expiresAt} > now())), 0) as int)`,
				})
				.from(creditGrants)
				.where(inArray(creditGrants.userId, ids))
				.groupBy(creditGrants.userId),
			db
				.select({
					userId: usageEvents.userId,
					credits: sql<number>`cast(coalesce(sum(${usageEvents.creditsCharged}), 0) as int)`,
				})
				.from(usageEvents)
				.where(and(inArray(usageEvents.userId, ids), gte(usageEvents.createdAt, sql`date_trunc('month', now())`)))
				.groupBy(usageEvents.userId),
		]);

		const keyCountByUser = new Map(keyCounts.map((r) => [r.userId, r.n]));
		const lastSeenByUser = new Map(lastSeen.map((r) => [r.userId, r.lastAt]));
		const bonusByUser = new Map(bonus.map((r) => [r.userId, r.sumActive]));
		const usedByUser = new Map(used.map((r) => [r.userId, r.credits]));

		return c.json({
			users: rows.map((r) => {
				const tierLimit = TIER_LIMITS[r.tier as Tier].credits;
				const bonusCredits = bonusByUser.get(r.id) ?? 0;
				return {
					id: r.id,
					email: r.email,
					name: r.name,
					image: r.image,
					tier: r.tier,
					role: r.role,
					emailVerified: r.emailVerified,
					activeKeyCount: keyCountByUser.get(r.id) ?? 0,
					bonusCredits,
					creditsUsed: usedByUser.get(r.id) ?? 0,
					creditsLimit: Math.max(0, tierLimit + bonusCredits),
					createdAt: r.createdAt.toISOString(),
					lastActiveAt: lastSeenByUser.get(r.id)?.toISOString() ?? null,
				};
			}),
			total: totalRow[0]?.count ?? 0,
			limit,
			offset,
		});
	},
);

/* ----------------------------- /users/:id (GET) --------------------------- */

adminRoute.get(
	"/users/:id",
	describeRoute({
		tags: ["Admin"],
		summary: "Full user detail (keys + grants + usage)",
		responses: {
			200: jsonResponse("Detail.", AdminUserDetail),
			401: errorResponse("Not signed in."),
			403: errorResponse("Admin role required."),
			404: errorResponse("User not found."),
		},
	}),
	async (c) => {
		const id = c.req.param("id");
		const detail = await loadUserDetail(id);
		if (!detail) return c.json({ error: "not_found" as const, message: "User not found." }, 404);
		return c.json(detail);
	},
);

/* ---------------------------- /users/:id (PATCH) -------------------------- */

adminRoute.patch(
	"/users/:id",
	describeRoute({
		tags: ["Admin"],
		summary: "Update tier and/or role",
		description:
			"Sets `user.tier` and/or `user.role`. No Stripe state is touched — admin tier overrides are independent of subscriptions. To revert, PATCH again.",
		responses: {
			200: jsonResponse("Detail.", AdminUserDetail),
			400: errorResponse("Validation failed."),
			401: errorResponse("Not signed in."),
			403: errorResponse("Admin role required."),
			404: errorResponse("User not found."),
		},
	}),
	tbBody(AdminUserPatchRequest),
	async (c) => {
		const id = c.req.param("id");
		const body = c.req.valid("json");
		const patch: Partial<{ tier: Tier; role: "user" | "admin" }> = {};
		if (body.tier) patch.tier = body.tier;
		if (body.role) patch.role = body.role;
		if (Object.keys(patch).length === 0) {
			return c.json({ error: "validation_failed" as const, message: "Provide tier and/or role." }, 400);
		}
		const [row] = await db
			.update(userTable)
			.set({ ...patch, updatedAt: new Date() })
			.where(eq(userTable.id, id))
			.returning({ id: userTable.id });
		if (!row) return c.json({ error: "not_found" as const, message: "User not found." }, 404);
		const detail = await loadUserDetail(id);
		return c.json(detail!);
	},
);

/* --------------------------- /users/:id/credits --------------------------- */

adminRoute.post(
	"/users/:id/credits",
	describeRoute({
		tags: ["Admin"],
		summary: "Grant (or claw back) credits",
		description:
			"Inserts a row into `credit_grants`. Positive `creditsDelta` adds to the user's monthly limit; negative subtracts. With no `expiresAt`, the grant is permanent until revoked. To grant 'this month only', set `expiresAt` to the first of next month UTC.",
		responses: {
			201: jsonResponse("Detail with new grant included.", AdminUserDetail),
			400: errorResponse("Validation failed."),
			401: errorResponse("Not signed in."),
			403: errorResponse("Admin role required."),
			404: errorResponse("User not found."),
		},
	}),
	tbBody(AdminGrantCreateRequest),
	async (c) => {
		const id = c.req.param("id");
		const body = c.req.valid("json");
		const admin = c.var.user;

		const [target] = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.id, id)).limit(1);
		if (!target) return c.json({ error: "not_found" as const, message: "User not found." }, 404);

		await db.insert(creditGrants).values({
			userId: id,
			creditsDelta: body.creditsDelta,
			reason: body.reason,
			grantedByUserId: admin.id,
			expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
		});

		const detail = await loadUserDetail(id);
		return c.json(detail!, 201);
	},
);

/* ---------------------------- /grants/:id (DELETE) ------------------------ */

adminRoute.delete(
	"/grants/:id",
	describeRoute({
		tags: ["Admin"],
		summary: "Revoke a credit grant",
		description:
			"Marks the grant as revoked (append-only — the row stays for audit). The next `snapshotUsage` call no longer counts it toward `bonusCredits`.",
		responses: {
			200: { description: "Revoked." },
			401: errorResponse("Not signed in."),
			403: errorResponse("Admin role required."),
			404: errorResponse("Grant not found."),
		},
	}),
	tbBody(AdminGrantRevokeRequest),
	async (c) => {
		const id = c.req.param("id");
		const body = c.req.valid("json");
		const admin = c.var.user;
		const [row] = await db
			.update(creditGrants)
			.set({ revokedAt: new Date(), revokedByUserId: admin.id, revokeReason: body.reason ?? null })
			.where(and(eq(creditGrants.id, id), isNull(creditGrants.revokedAt)))
			.returning({ id: creditGrants.id, userId: creditGrants.userId });
		if (!row) return c.json({ error: "not_found" as const, message: "Grant not found or already revoked." }, 404);
		return c.json({ id: row.id, userId: row.userId, revoked: true });
	},
);

/* ----------------------------- /users/:id/keys ---------------------------- */

adminRoute.post(
	"/users/:id/keys",
	describeRoute({
		tags: ["Admin"],
		summary: "Issue a key on behalf of a user",
		description: "Creates a key inheriting the user's current tier. Plaintext is returned exactly once.",
		responses: {
			201: jsonResponse("Key created.", KeyCreateResponse),
			401: errorResponse("Not signed in."),
			403: errorResponse("Admin role required."),
			404: errorResponse("User not found."),
		},
	}),
	tbBody(AdminKeyIssueRequest),
	async (c) => {
		const id = c.req.param("id");
		const body = c.req.valid("json");
		const [target] = await db
			.select({ id: userTable.id, email: userTable.email, tier: userTable.tier })
			.from(userTable)
			.where(eq(userTable.id, id))
			.limit(1);
		if (!target) return c.json({ error: "not_found" as const, message: "User not found." }, 404);
		const issued = await issueKey({
			tier: target.tier as Tier,
			name: body.name,
			ownerEmail: target.email,
			userId: target.id,
		});
		return c.json(
			{
				id: issued.id,
				tier: issued.tier,
				prefix: issued.prefix,
				suffix: issued.suffix,
				plaintext: issued.plaintext,
				notice: "Save plaintext now — it will never be shown again.",
			},
			201,
		);
	},
);

/* ------------------------------- /keys/:id -------------------------------- */

adminRoute.delete(
	"/keys/:id",
	describeRoute({
		tags: ["Admin"],
		summary: "Force-revoke any API key",
		responses: {
			200: jsonResponse("Revoked.", KeyRevokeResponse),
			401: errorResponse("Not signed in."),
			403: errorResponse("Admin role required."),
			404: errorResponse("Key not found."),
		},
	}),
	async (c) => {
		const id = c.req.param("id");
		const [row] = await db.select({ id: apiKeys.id }).from(apiKeys).where(eq(apiKeys.id, id)).limit(1);
		if (!row) return c.json({ error: "not_found" as const, message: "Key not found." }, 404);
		await revokeKey(id);
		return c.json({ id, revoked: true });
	},
);

/* ---------------------------- /takedowns/:id/* (admin triage) ----------- */

adminRoute.post(
	"/takedowns/:id/approve-counter",
	describeRoute({
		tags: ["Admin"],
		summary: "Approve a §512(g) counter-notice + restore the listing",
		description:
			"Operator approval of a counter-notice. Clears `takedownAt` on every listing_observations row matching the affected itemId, marks the counter-notice request as `approved`, and emails the original takedown submitter per 17 U.S.C. §512(g)(2)(B). Resend wiring is best-effort; the restore happens regardless.",
		responses: {
			200: { description: "Counter-notice approved + listing restored." },
			401: errorResponse("Not signed in."),
			403: errorResponse("Admin role required."),
			404: errorResponse("Counter-notice not found."),
		},
	}),
	async (c) => {
		const id = c.req.param("id");
		const [counter] = await db
			.select({
				id: takedownRequests.id,
				itemId: takedownRequests.itemId,
				reason: takedownRequests.reason,
				contactEmail: takedownRequests.contactEmail,
				status: takedownRequests.status,
			})
			.from(takedownRequests)
			.where(eq(takedownRequests.id, id))
			.limit(1);
		if (!counter) return c.json({ error: "not_found" as const, message: "Counter-notice not found." }, 404);
		if (!counter.reason?.startsWith("[counter_notice]")) {
			return c.json(
				{ error: "not_a_counter_notice" as const, message: "This row is not a counter-notice (kind mismatch)." },
				400,
			);
		}
		// Find the original takedown(s) for the same itemId so we know
		// who to forward §512(g)(2)(B) notice to. The first non-counter
		// row is the canonical original.
		const originals = await db
			.select({
				id: takedownRequests.id,
				contactEmail: takedownRequests.contactEmail,
				createdAt: takedownRequests.createdAt,
				reason: takedownRequests.reason,
			})
			.from(takedownRequests)
			.where(eq(takedownRequests.itemId, counter.itemId))
			.orderBy(asc(takedownRequests.createdAt));
		const original = originals.find((o) => !o.reason?.startsWith("[counter_notice]")) ?? null;

		const legacyId = legacyFromV1(counter.itemId) ?? counter.itemId;
		// Restore the listing observations: clear takedownAt on every
		// matching legacyItemId row. Audit trail (the counter-notice + the
		// original takedown rows themselves) stays.
		await db
			.update(listingObservations)
			.set({ takedownAt: null })
			.where(eq(listingObservations.legacyItemId, legacyId));
		await db
			.update(takedownRequests)
			.set({ status: "approved", processedAt: new Date() })
			.where(eq(takedownRequests.id, id));

		// §512(g)(2)(B): forward the counter-notice to the original
		// submitter and notify them the material will be restored within
		// 10–14 business days unless they file a court action. Resend
		// silently no-ops when unconfigured so we report `notifiedOriginal`
		// only when both the contact email and a wired email backend exist.
		const willNotify = Boolean(original?.contactEmail && config.RESEND_API_KEY);
		if (original?.contactEmail) {
			try {
				await sendOpsEmail({
					to: original.contactEmail,
					subject: `[flipagent] Counter-notice received — ${counter.itemId}`,
					text:
						`A counter-notice has been filed for itemId ${counter.itemId}, which you previously requested removed.\n\n` +
						`Per 17 U.S.C. §512(g)(2)(B), the material will be restored on flipagent's cache within 10 business days unless you file a court action seeking a restraining order against the counter-notifier and provide flipagent with notice of that filing.\n\n` +
						`Counter-notice contact: ${counter.contactEmail}\n` +
						`Counter-notice details: ${counter.reason}\n\n` +
						`If you believe the counter-notice is invalid or fraudulent, reply to this email or write legal@flipagent.dev within 10 business days.\n`,
				});
			} catch (err) {
				console.warn(`[admin/takedowns] §512(g) notice email failed for counter ${id}:`, err);
			}
		}

		return c.json({
			id,
			status: "approved" as const,
			restored: { legacyItemId: legacyId },
			notifiedOriginal: willNotify,
		});
	},
);

/* ------------------------------ /evaluations ------------------------------
 * Cross-tenant browse over completed evaluate jobs. Deduped to the latest
 * row per `(item->>itemId)` because the same listing may have been
 * evaluated repeatedly — older snapshots would mislead. Default sort is
 * expected-net DESC so admins see the best E[net] picks across the whole
 * platform first. Approved takedowns are excluded; the takedown blocklist
 * is the authority on what may surface.
 *
 * The CTE costs ~one full scan over completed evaluates (no expression
 * index on result->'item'->>'itemId' yet) but the table is bounded by
 * `expiresAt` GC and admin traffic is low, so it's fine for now. When
 * this surface goes public we'll add a generated column + btree index. */

adminRoute.get(
	"/evaluations",
	describeRoute({
		tags: ["Admin"],
		summary: "Browse all completed evaluations across users",
		responses: {
			200: jsonResponse("Evaluations.", AdminEvaluationList),
			401: errorResponse("Not signed in."),
			403: errorResponse("Admin role required."),
		},
	}),
	tbCoerce("query", AdminEvaluationListQuery),
	async (c) => {
		const q = c.req.valid("query");
		const limit = q.limit ?? 50;
		const offset = q.offset ?? 0;

		// Build the dynamic WHERE fragment. Each branch is a parameterised
		// `sql\`\`` chunk — joining with ` AND ` happens inside the CTE.
		const conds: ReturnType<typeof sql>[] = [
			sql`kind = 'evaluate'`,
			sql`status = 'completed'`,
			sql`result IS NOT NULL`,
		];
		if (q.q) {
			const like = `%${q.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
			conds.push(sql`(result->'item'->>'title') ILIKE ${like}`);
		}
		if (q.rating) conds.push(sql`(result->'evaluation'->>'rating') = ${q.rating}`);
		if (typeof q.minNetCents === "number") {
			conds.push(sql`((result->'evaluation'->>'expectedNetCents')::int) >= ${q.minNetCents}`);
		}
		if (q.marketplace) {
			conds.push(sql`(result->'market'->>'marketplace') = ${q.marketplace}`);
		}
		const whereClause = sql.join(conds, sql` AND `);

		const orderClause =
			q.sort === "net_asc"
				? sql`net_cents ASC NULLS LAST`
				: q.sort === "recent"
					? sql`completed_at DESC NULLS LAST`
					: sql`net_cents DESC NULLS LAST`;

		// Row CTE: dedup-by-itemId via row_number, then filter out approved
		// takedowns by joining against `takedown_requests`. Keep the latest
		// (rn=1) row per itemId.
		const rowsQuery = sql`
			WITH ranked AS (
				SELECT
					id,
					result,
					completed_at,
					(result->'evaluation'->>'expectedNetCents')::int AS net_cents,
					row_number() OVER (
						PARTITION BY (result->'item'->>'itemId')
						ORDER BY completed_at DESC NULLS LAST
					) AS rn
				FROM compute_jobs
				WHERE ${whereClause}
			)
			SELECT id, result, completed_at, net_cents
			FROM ranked
			WHERE rn = 1
				AND (result->'item'->>'itemId') NOT IN (
					SELECT item_id FROM takedown_requests WHERE status = 'approved'
				)
			ORDER BY ${orderClause}, completed_at DESC NULLS LAST
			LIMIT ${limit} OFFSET ${offset}
		`;

		const totalQuery = sql`
			WITH ranked AS (
				SELECT
					(result->'item'->>'itemId') AS item_id,
					row_number() OVER (
						PARTITION BY (result->'item'->>'itemId')
						ORDER BY completed_at DESC NULLS LAST
					) AS rn
				FROM compute_jobs
				WHERE ${whereClause}
			)
			SELECT count(*)::int AS n
			FROM ranked
			WHERE rn = 1
				AND item_id NOT IN (
					SELECT item_id FROM takedown_requests WHERE status = 'approved'
				)
		`;

		const [rowsResult, totalResult] = await Promise.all([
			db.execute<{
				id: string;
				result: unknown;
				completed_at: Date | string | null;
				net_cents: number | null;
			}>(rowsQuery),
			db.execute<{ n: number }>(totalQuery),
		]);

		const rows: AdminEvaluationRow[] = [];
		for (const raw of rowsResult as Array<{
			id: string;
			result: unknown;
			completed_at: Date | string | null;
			net_cents: number | null;
		}>) {
			const r = raw.result as EvaluateResultLike | null;
			if (!r?.item || !r.evaluation) continue;
			if (!r.item.itemId || !r.item.title || !r.item.itemWebUrl) continue;
			if (!raw.completed_at) continue;
			const completedAt = raw.completed_at instanceof Date ? raw.completed_at : new Date(raw.completed_at);
			rows.push(toEvaluationRow(raw.id, r, completedAt));
		}

		const total = Number((totalResult as Array<{ n: number }>)[0]?.n ?? 0);
		return c.json({ rows, total, limit, offset });
	},
);

/* GET /v1/admin/evaluations/:jobId — full EvaluateResponse for the row.
 * Used by the deals table to seed the drawer with the cached evaluation
 * (no re-run, no credit spend). The list endpoint above only ships a
 * slim summary; the drawer needs the full sold/active digests + filter
 * counts + market stats. */
adminRoute.get(
	"/evaluations/:jobId",
	describeRoute({
		tags: ["Admin"],
		summary: "Full cached evaluation result for one job",
		responses: {
			200: jsonResponse("Full EvaluateResponse.", EvaluateResponse),
			401: errorResponse("Not signed in."),
			403: errorResponse("Admin role required."),
			404: errorResponse("Job not found or not a completed evaluate."),
		},
	}),
	async (c) => {
		const jobId = c.req.param("jobId");
		const [row] = await db
			.select({ result: computeJobs.result, kind: computeJobs.kind, status: computeJobs.status })
			.from(computeJobs)
			.where(eq(computeJobs.id, jobId))
			.limit(1);
		if (!row || row.kind !== "evaluate" || row.status !== "completed" || !row.result) {
			return c.json({ error: "not_found", message: "Evaluation not found." }, 404);
		}
		return c.json(row.result);
	},
);

/** Loose mirror of `EvaluateResponse` — only the bits this surface needs.
 *  `result` is JSONB so we accept it as `unknown` and shape it here rather
 *  than importing the full schema (which would couple admin to the
 *  evaluate types' churn). */
type EvaluateResultLike = {
	item?: {
		itemId?: string;
		title?: string;
		itemWebUrl?: string;
		condition?: string;
		categoryPath?: string;
		categoryName?: string;
		image?: { imageUrl?: string };
		additionalImages?: Array<{ imageUrl?: string }>;
		price?: { value?: string };
		currentBidPrice?: { value?: string };
		seller?: { feedbackScore?: number; feedbackPercentage?: string };
	};
	evaluation?: {
		rating?: "buy" | "skip";
		expectedNetCents?: number;
		successNetCents?: number | null;
		maxLossCents?: number | null;
		recommendedExit?: { listPriceCents?: number; expectedDaysToSell?: number } | null;
		risk?: { P_fraud?: number } | null;
	};
	market?: {
		marketplace?: string;
		medianCents?: number;
		salesPerDay?: number;
		nObservations?: number;
		asks?: { nActive?: number };
	};
	meta?: { lookbackDays?: number };
};

function toEvaluationRow(jobId: string, r: EvaluateResultLike, completedAt: Date): AdminEvaluationRow {
	const item = r.item ?? {};
	const ev = r.evaluation ?? {};
	const market = r.market ?? {};
	const meta = r.meta ?? {};
	const image = item.image?.imageUrl ?? item.additionalImages?.[0]?.imageUrl;
	const askingStr = item.price?.value ?? item.currentBidPrice?.value;
	const askingPriceCents = askingStr ? Math.round(Number.parseFloat(askingStr) * 100) : null;
	// Marketplace literal is currently `ebay_us` only — the column lives
	// on `result.market.marketplace` so adding more later doesn't change
	// this surface. Default to `ebay_us` for legacy rows missing it.
	const marketplace = (market.marketplace === "ebay_us" ? "ebay_us" : "ebay_us") as "ebay_us";
	const fbPctStr = item.seller?.feedbackPercentage;
	const fbPct = fbPctStr != null ? Number.parseFloat(fbPctStr) : null;
	return {
		jobId,
		marketplace,
		itemId: item.itemId!,
		title: item.title!,
		itemWebUrl: item.itemWebUrl!,
		...(image ? { image } : {}),
		condition: item.condition ?? null,
		categoryName: item.categoryName ?? extractLeafCategory(item.categoryPath),
		askingPriceCents: Number.isFinite(askingPriceCents) ? askingPriceCents : null,
		rating: ev.rating ?? "skip",
		expectedNetCents: ev.expectedNetCents ?? 0,
		successNetCents: ev.successNetCents ?? null,
		maxLossCents: ev.maxLossCents ?? null,
		medianSoldCents: market.medianCents ?? 0,
		nSold: market.nObservations ?? 0,
		salesPerDay: market.salesPerDay ?? 0,
		nActive: market.asks?.nActive ?? 0,
		expectedDaysToSell: ev.recommendedExit?.expectedDaysToSell ?? null,
		recommendedListPriceCents: ev.recommendedExit?.listPriceCents ?? null,
		pFraud: typeof ev.risk?.P_fraud === "number" ? ev.risk.P_fraud : null,
		sellerFeedbackScore: typeof item.seller?.feedbackScore === "number" ? item.seller.feedbackScore : null,
		sellerFeedbackPercent: fbPct != null && Number.isFinite(fbPct) ? fbPct : null,
		lookbackDays: meta.lookbackDays ?? 0,
		completedAt: completedAt.toISOString(),
	};
}

function extractLeafCategory(path: string | undefined): string | null {
	if (!path) return null;
	const parts = path.split(/\s*[>›]\s*/).filter(Boolean);
	return parts[parts.length - 1] ?? null;
}

/* --------------------------------- helpers -------------------------------- */

async function loadUserDetail(id: string) {
	const [row] = await db
		.select({
			id: userTable.id,
			email: userTable.email,
			name: userTable.name,
			image: userTable.image,
			tier: userTable.tier,
			role: userTable.role,
			emailVerified: userTable.emailVerified,
			createdAt: userTable.createdAt,
			subscriptionStatus: userTable.subscriptionStatus,
			pastDueSince: userTable.pastDueSince,
			autoRechargeEnabled: userTable.autoRechargeEnabled,
			autoRechargeTarget: userTable.autoRechargeTarget,
			lastAutoRechargeAt: userTable.lastAutoRechargeAt,
		})
		.from(userTable)
		.where(eq(userTable.id, id))
		.limit(1);
	if (!row) return null;

	// Snapshot enforcement against the *effective* tier so admin sees
	// the same numbers the api middleware actually applies.
	const enforcedTier = effectiveTier({
		tier: row.tier as Tier,
		subscriptionStatus: row.subscriptionStatus,
		pastDueSince: row.pastDueSince,
	});

	const [keys, grants, usage, lastSeenRow, bonusForList] = await Promise.all([
		db
			.select({
				id: apiKeys.id,
				name: apiKeys.name,
				prefix: apiKeys.keyPrefix,
				suffix: apiKeys.keySuffix,
				tier: apiKeys.tier,
				createdAt: apiKeys.createdAt,
				lastUsedAt: apiKeys.lastUsedAt,
				revokedAt: apiKeys.revokedAt,
			})
			.from(apiKeys)
			.where(eq(apiKeys.userId, id))
			.orderBy(desc(apiKeys.createdAt)),
		// Join grants to the granter/revoker emails so the UI can show "by jin@…".
		db
			.select({
				id: creditGrants.id,
				userId: creditGrants.userId,
				creditsDelta: creditGrants.creditsDelta,
				reason: creditGrants.reason,
				grantedByUserId: creditGrants.grantedByUserId,
				expiresAt: creditGrants.expiresAt,
				revokedAt: creditGrants.revokedAt,
				revokedByUserId: creditGrants.revokedByUserId,
				revokeReason: creditGrants.revokeReason,
				createdAt: creditGrants.createdAt,
			})
			.from(creditGrants)
			.where(eq(creditGrants.userId, id))
			.orderBy(desc(creditGrants.createdAt)),
		snapshotUsage({ apiKeyId: "", userId: id }, enforcedTier),
		db
			.select({ lastAt: max(usageEvents.createdAt) })
			.from(usageEvents)
			.where(eq(usageEvents.userId, id)),
		sumActiveCreditGrants(id),
	]);

	// Resolve granter/revoker emails in one pass.
	const granterIds = Array.from(
		new Set([
			...grants.map((g) => g.grantedByUserId).filter((v): v is string => Boolean(v)),
			...grants.map((g) => g.revokedByUserId).filter((v): v is string => Boolean(v)),
		]),
	);
	const granterEmails = new Map<string, string>();
	if (granterIds.length > 0) {
		const granterRows = await db
			.select({ id: userTable.id, email: userTable.email })
			.from(userTable)
			.where(inArray(userTable.id, granterIds));
		for (const g of granterRows) granterEmails.set(g.id, g.email);
	}

	const now = Date.now();
	const grantsOut = grants.map((g) => ({
		id: g.id,
		userId: g.userId,
		creditsDelta: g.creditsDelta,
		reason: g.reason,
		grantedByUserId: g.grantedByUserId,
		grantedByEmail: g.grantedByUserId ? (granterEmails.get(g.grantedByUserId) ?? null) : null,
		expiresAt: g.expiresAt ? g.expiresAt.toISOString() : null,
		revokedAt: g.revokedAt ? g.revokedAt.toISOString() : null,
		revokedByUserId: g.revokedByUserId,
		revokedByEmail: g.revokedByUserId ? (granterEmails.get(g.revokedByUserId) ?? null) : null,
		revokeReason: g.revokeReason,
		active: !g.revokedAt && (!g.expiresAt || g.expiresAt.getTime() > now),
		createdAt: g.createdAt.toISOString(),
	}));

	return {
		user: {
			id: row.id,
			email: row.email,
			name: row.name,
			image: row.image,
			tier: row.tier,
			// Tier the api enforces against — diverges from `tier` when
			// the user has been past_due longer than the grace window.
			// Admins reading "tier=standard, effectiveTier=free" know
			// instantly that this is a card-failure downgrade, not an
			// inconsistent state.
			effectiveTier: enforcedTier,
			role: row.role,
			emailVerified: row.emailVerified,
			subscriptionStatus: row.subscriptionStatus,
			pastDueSince: row.pastDueSince ? row.pastDueSince.toISOString() : null,
			autoRecharge: {
				enabled: row.autoRechargeEnabled,
				targetCredits: row.autoRechargeTarget,
				lastRechargedAt: row.lastAutoRechargeAt ? row.lastAutoRechargeAt.toISOString() : null,
			},
			activeKeyCount: keys.filter((k) => !k.revokedAt).length,
			bonusCredits: bonusForList,
			creditsUsed: usage.creditsUsed,
			creditsLimit: usage.creditsLimit,
			createdAt: row.createdAt.toISOString(),
			lastActiveAt: lastSeenRow[0]?.lastAt ? lastSeenRow[0].lastAt.toISOString() : null,
		},
		keys: keys.map((k) => ({
			id: k.id,
			name: k.name,
			prefix: k.prefix,
			suffix: k.suffix,
			tier: k.tier,
			createdAt: k.createdAt.toISOString(),
			lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
			revokedAt: k.revokedAt ? k.revokedAt.toISOString() : null,
		})),
		grants: grantsOut,
		usage: usageToWire(usage),
	};
}
