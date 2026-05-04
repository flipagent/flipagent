/**
 * Schemas for the `/v1/admin/*` operator surface. Session-cookie auth
 * gated by `requireAdmin` (= role==='admin'). Bootstrap admins via the
 * `ADMIN_EMAILS` env var on the api host.
 */

import { type Static, Type } from "@sinclair/typebox";
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
		thresholdCredits: Type.Union([Type.Integer(), Type.Null()]),
		topUpCredits: Type.Union([Type.Integer(), Type.Null()]),
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
