/**
 * Schemas for the `/v1/admin/*` operator surface. Session-cookie auth
 * gated by `requireAdmin` (= role==='admin'). Bootstrap admins via the
 * `ADMIN_EMAILS` env var on the api host.
 */

import { type Static, Type } from "@sinclair/typebox";
import { Marketplace } from "./_common.js";
import { Role, Tier } from "./flipagent.js";

/* ------------------------------- users list ------------------------------- */

export const AdminUserListQuery = Type.Object(
	{
		q: Type.Optional(Type.String({ description: "Substring search on email or name (case-insensitive)." })),
		tier: Type.Optional(Tier),
		role: Type.Optional(Role),
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
		offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
	},
	{ $id: "AdminUserListQuery" },
);
export type AdminUserListQuery = Static<typeof AdminUserListQuery>;

export const AdminAutoRechargeView = Type.Object(
	{
		enabled: Type.Boolean(),
		targetCredits: Type.Union([Type.Integer(), Type.Null()]),
		lastRechargedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
	},
	{ $id: "AdminAutoRechargeView" },
);
export type AdminAutoRechargeView = Static<typeof AdminAutoRechargeView>;

export const AdminUserSummary = Type.Object(
	{
		id: Type.String(),
		email: Type.String({ format: "email" }),
		name: Type.String(),
		image: Type.Union([Type.String(), Type.Null()]),
		tier: Tier,
		// Tier the api enforces against — equal to `tier` 99% of the time;
		// drops to `free` when the user's subscription has been past_due
		// past the grace window. Only ever appears on the detail view (not
		// on the list) because the list query doesn't compute it per-row.
		effectiveTier: Type.Optional(Tier),
		role: Role,
		emailVerified: Type.Boolean(),
		// Stripe subscription state. Surfaces on the detail view so admins
		// can disambiguate "tier=standard, effective=free" without a raw
		// DB query.
		subscriptionStatus: Type.Optional(Type.Union([Type.String(), Type.Null()])),
		pastDueSince: Type.Optional(Type.Union([Type.String({ format: "date-time" }), Type.Null()])),
		autoRecharge: Type.Optional(AdminAutoRechargeView),
		// Active key count (revokedAt IS NULL).
		activeKeyCount: Type.Integer(),
		// Sum of active credit grants (positive + negative). 0 when none.
		bonusCredits: Type.Integer(),
		// Credit usage in the current monthly window (or lifetime for Free).
		creditsUsed: Type.Integer(),
		creditsLimit: Type.Integer(),
		createdAt: Type.String({ format: "date-time" }),
		// Most recent usage_events.created_at across all keys, or null when
		// the user hasn't made any metered call yet.
		lastActiveAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
	},
	{ $id: "AdminUserSummary" },
);
export type AdminUserSummary = Static<typeof AdminUserSummary>;

export const AdminUserList = Type.Object(
	{
		users: Type.Array(AdminUserSummary),
		total: Type.Integer({ description: "Total matching users (pre-pagination)." }),
		limit: Type.Integer(),
		offset: Type.Integer(),
	},
	{ $id: "AdminUserList" },
);
export type AdminUserList = Static<typeof AdminUserList>;

/* ------------------------------- user detail ------------------------------ */

export const AdminUserKey = Type.Object(
	{
		id: Type.String(),
		name: Type.Union([Type.String(), Type.Null()]),
		prefix: Type.String(),
		suffix: Type.Union([Type.String(), Type.Null()]),
		tier: Tier,
		createdAt: Type.String({ format: "date-time" }),
		lastUsedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
		revokedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
	},
	{ $id: "AdminUserKey" },
);
export type AdminUserKey = Static<typeof AdminUserKey>;

export const AdminGrant = Type.Object(
	{
		id: Type.String(),
		userId: Type.String(),
		creditsDelta: Type.Integer({
			description: "Positive = bonus, negative = clawback. Stays in effect until revoked or expired.",
		}),
		reason: Type.String(),
		grantedByUserId: Type.Union([Type.String(), Type.Null()]),
		grantedByEmail: Type.Union([Type.String({ format: "email" }), Type.Null()]),
		expiresAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
		revokedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
		revokedByUserId: Type.Union([Type.String(), Type.Null()]),
		revokedByEmail: Type.Union([Type.String({ format: "email" }), Type.Null()]),
		revokeReason: Type.Union([Type.String(), Type.Null()]),
		// Computed: not revoked AND (no expiresAt OR expiresAt > now()).
		active: Type.Boolean(),
		createdAt: Type.String({ format: "date-time" }),
	},
	{ $id: "AdminGrant" },
);
export type AdminGrant = Static<typeof AdminGrant>;

export const AdminUserDetail = Type.Object(
	{
		user: AdminUserSummary,
		keys: Type.Array(AdminUserKey),
		grants: Type.Array(AdminGrant),
		usage: Type.Object({
			creditsUsed: Type.Integer(),
			creditsLimit: Type.Integer(),
			creditsRemaining: Type.Integer(),
			bonusCredits: Type.Integer(),
			resetAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
		}),
	},
	{ $id: "AdminUserDetail" },
);
export type AdminUserDetail = Static<typeof AdminUserDetail>;

/* --------------------------------- mutations ------------------------------ */

export const AdminUserPatchRequest = Type.Object(
	{
		tier: Type.Optional(Tier),
		role: Type.Optional(Role),
	},
	{ $id: "AdminUserPatchRequest" },
);
export type AdminUserPatchRequest = Static<typeof AdminUserPatchRequest>;

export const AdminGrantCreateRequest = Type.Object(
	{
		creditsDelta: Type.Integer({ minimum: -10_000_000, maximum: 10_000_000 }),
		reason: Type.String({ minLength: 1, maxLength: 280 }),
		// ISO date-time. Null/omitted = no expiry (permanent until revoked).
		// To grant "this month only", set to the first of next month UTC.
		expiresAt: Type.Optional(Type.Union([Type.String({ format: "date-time" }), Type.Null()])),
	},
	{ $id: "AdminGrantCreateRequest" },
);
export type AdminGrantCreateRequest = Static<typeof AdminGrantCreateRequest>;

export const AdminGrantRevokeRequest = Type.Object(
	{
		reason: Type.Optional(Type.String({ maxLength: 280 })),
	},
	{ $id: "AdminGrantRevokeRequest" },
);
export type AdminGrantRevokeRequest = Static<typeof AdminGrantRevokeRequest>;

export const AdminKeyIssueRequest = Type.Object(
	{
		name: Type.Optional(Type.String({ maxLength: 80 })),
	},
	{ $id: "AdminKeyIssueRequest" },
);
export type AdminKeyIssueRequest = Static<typeof AdminKeyIssueRequest>;

/* ---------------------------------- stats --------------------------------- */

export const AdminStats = Type.Object(
	{
		users: Type.Object({
			total: Type.Integer(),
			byTier: Type.Object({
				free: Type.Integer(),
				hobby: Type.Integer(),
				standard: Type.Integer(),
				growth: Type.Integer(),
			}),
			admins: Type.Integer(),
			signedUpLast30d: Type.Integer(),
		}),
		keys: Type.Object({
			active: Type.Integer(),
			revoked: Type.Integer(),
		}),
		grants: Type.Object({
			active: Type.Integer(),
			activeBonusCredits: Type.Integer({ description: "Sum of credits_delta across active grants." }),
			grantedLast30d: Type.Integer({ description: "Count of grants created in the last 30 days." }),
		}),
		usage: Type.Object({
			creditsThisMonth: Type.Integer(),
			callsThisMonth: Type.Integer(),
		}),
	},
	{ $id: "AdminStats" },
);
export type AdminStats = Static<typeof AdminStats>;

/* ----------------------------- evaluations -------------------------------
 * Cross-tenant browse over `compute_jobs` rows where `kind='evaluate'` and
 * `status='completed'`. Deduped server-side to the latest row per itemId
 * (the same itemId may have been evaluated repeatedly; a stale older
 * snapshot would mislead). Default sort: expectedNetCents DESC. Eventually
 * the same surface goes public — for now it's admin-gated and lives at
 * `/v1/admin/evaluations`. */

export const AdminEvaluationListQuery = Type.Object(
	{
		q: Type.Optional(Type.String({ description: "Substring search on item title (case-insensitive)." })),
		rating: Type.Optional(Type.Union([Type.Literal("buy"), Type.Literal("skip")])),
		minNetCents: Type.Optional(
			Type.Integer({
				description: "Lower bound on expectedNetCents. Useful to hide near-zero / negative E[net] rows.",
			}),
		),
		marketplace: Type.Optional(Marketplace),
		sort: Type.Optional(
			Type.Union([Type.Literal("net_desc"), Type.Literal("net_asc"), Type.Literal("recent")], {
				description: "net_desc (default) = expectedNetCents desc; net_asc = ascending; recent = completedAt desc.",
			}),
		),
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
		offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
	},
	{ $id: "AdminEvaluationListQuery" },
);
export type AdminEvaluationListQuery = Static<typeof AdminEvaluationListQuery>;

export const AdminEvaluationRow = Type.Object(
	{
		/** compute_jobs.id of the evaluation that produced this row. */
		jobId: Type.String(),
		marketplace: Marketplace,
		itemId: Type.String(),
		title: Type.String(),
		/** Always present — eBay ToS requires every cached row carry the original web URL. */
		itemWebUrl: Type.String({ format: "uri" }),
		image: Type.Optional(Type.String({ format: "uri" })),
		condition: Type.Union([Type.String(), Type.Null()]),
		categoryName: Type.Union([Type.String(), Type.Null()]),
		/** Current asking price on the listing at evaluation time. */
		askingPriceCents: Type.Union([Type.Integer(), Type.Null()]),
		rating: Type.Union([Type.Literal("buy"), Type.Literal("skip")]),
		/** Sort key. Probabilistic E[net] per trade — `(1−P_fraud)·successNet − P_fraud·maxLoss`. */
		expectedNetCents: Type.Integer(),
		successNetCents: Type.Union([Type.Integer(), Type.Null()]),
		maxLossCents: Type.Union([Type.Integer(), Type.Null()]),
		medianSoldCents: Type.Integer(),
		salesPerDay: Type.Number(),
		expectedDaysToSell: Type.Union([Type.Number(), Type.Null()]),
		recommendedListPriceCents: Type.Union([Type.Integer(), Type.Null()]),
		/** Probability of fraud / not-as-described, derived from seller
		 *  feedback count + percent via Beta-Bernoulli posterior. 0..0.5.
		 *  Null when the evaluation didn't compute risk (no feedback data). */
		pFraud: Type.Union([Type.Number(), Type.Null()]),
		/** Raw seller feedback score (positive count). Surfaced for tooltip
		 *  context — pFraud is the actionable summary. */
		sellerFeedbackScore: Type.Union([Type.Integer(), Type.Null()]),
		/** Raw seller positive-feedback percent (0..100). */
		sellerFeedbackPercent: Type.Union([Type.Number(), Type.Null()]),
		lookbackDays: Type.Integer(),
		completedAt: Type.String({ format: "date-time" }),
	},
	{ $id: "AdminEvaluationRow" },
);
export type AdminEvaluationRow = Static<typeof AdminEvaluationRow>;

export const AdminEvaluationList = Type.Object(
	{
		rows: Type.Array(AdminEvaluationRow),
		total: Type.Integer({ description: "Total rows after dedup + filters, pre-pagination." }),
		limit: Type.Integer(),
		offset: Type.Integer(),
	},
	{ $id: "AdminEvaluationList" },
);
export type AdminEvaluationList = Static<typeof AdminEvaluationList>;
