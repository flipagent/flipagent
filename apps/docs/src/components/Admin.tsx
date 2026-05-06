/**
 * Admin operator dashboard. Session-cookie auth; the Astro page mounts
 * this as a `client:only="react"` island, so all data fetching happens
 * on the client. Non-admins are redirected to /dashboard, signed-out
 * to /signup.
 *
 * Two-pane: users table on the left, drawer with full detail on the
 * right when a row is selected. Mutations (grant credits, change tier
 * / role, revoke key, revoke grant) all close the loop by re-fetching
 * the selected user's detail and the table row in place.
 */

import * as RxDialog from "@radix-ui/react-dialog";
import { type ReactNode, useEffect, useId, useState } from "react";
import { Toaster, toast } from "sonner";
import { apiFetch } from "../lib/authClient";
import { FormSelect } from "./compose/FormSelect";
import "./Admin.css";

type Tier = "free" | "hobby" | "standard" | "growth";
type Role = "user" | "admin";

type MeProfile = {
	id: string;
	email: string;
	name: string;
	role: Role;
};

type UserSummary = {
	id: string;
	email: string;
	name: string;
	image: string | null;
	tier: Tier;
	role: Role;
	emailVerified: boolean;
	activeKeyCount: number;
	bonusCredits: number;
	creditsUsed: number;
	creditsLimit: number;
	createdAt: string;
	lastActiveAt: string | null;
};

type UserList = {
	users: UserSummary[];
	total: number;
	limit: number;
	offset: number;
};

type Grant = {
	id: string;
	userId: string;
	creditsDelta: number;
	reason: string;
	grantedByUserId: string | null;
	grantedByEmail: string | null;
	expiresAt: string | null;
	revokedAt: string | null;
	revokedByUserId: string | null;
	revokedByEmail: string | null;
	revokeReason: string | null;
	active: boolean;
	createdAt: string;
};

type Key = {
	id: string;
	name: string | null;
	prefix: string;
	suffix: string | null;
	tier: Tier;
	createdAt: string;
	lastUsedAt: string | null;
	revokedAt: string | null;
};

type UserDetail = {
	user: UserSummary;
	keys: Key[];
	grants: Grant[];
	usage: {
		creditsUsed: number;
		creditsLimit: number;
		creditsRemaining: number;
		bonusCredits: number;
		resetAt: string | null;
	};
};

type Stats = {
	users: { total: number; byTier: Record<Tier, number>; admins: number; signedUpLast30d: number };
	keys: { active: number; revoked: number };
	grants: { active: number; activeBonusCredits: number; grantedLast30d: number };
	usage: { creditsThisMonth: number; callsThisMonth: number };
};

const TIERS: Tier[] = ["free", "hobby", "standard", "growth"];
const PAGE_SIZE = 50;

const TIER_FILTER_OPTIONS = [
	{ value: "", label: "All tiers" },
	...TIERS.map((t) => ({ value: t, label: t })),
] as const;
const ROLE_FILTER_OPTIONS = [
	{ value: "", label: "All roles" },
	{ value: "user", label: "user" },
	{ value: "admin", label: "admin" },
] as const;
const TIER_OPTIONS = TIERS.map((t) => ({ value: t, label: t }));
const ROLE_OPTIONS = [
	{ value: "user", label: "user" },
	{ value: "admin", label: "admin" },
] as const;
const EXPIRY_OPTIONS = [
	{ value: "none", label: "never" },
	{ value: "this_month", label: "end of this month" },
	{ value: "30d", label: "in 30 days" },
	{ value: "90d", label: "in 90 days" },
] as const;
type Expiry = (typeof EXPIRY_OPTIONS)[number]["value"];

export default function Admin() {
	const [me, setMe] = useState<MeProfile | null>(null);
	const [bootError, setBootError] = useState<string | null>(null);

	const [stats, setStats] = useState<Stats | null>(null);

	const [search, setSearch] = useState("");
	const [tierFilter, setTierFilter] = useState<"" | Tier>("");
	const [roleFilter, setRoleFilter] = useState<"" | Role>("");
	const [list, setList] = useState<UserList | null>(null);
	const [page, setPage] = useState(0);
	const [listLoading, setListLoading] = useState(false);

	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [detail, setDetail] = useState<UserDetail | null>(null);
	const [detailLoading, setDetailLoading] = useState(false);

	// Boot: fetch /v1/me, gate on role.
	useEffect(() => {
		(async () => {
			try {
				const profile = await apiFetch<MeProfile>("/v1/me");
				if (profile.role !== "admin") {
					window.location.href = "/dashboard/";
					return;
				}
				setMe(profile);
			} catch (err) {
				const status = (err as { status?: number }).status;
				if (status === 401) {
					window.location.href = "/signup/";
					return;
				}
				if (status === 503) {
					setBootError("Auth isn't configured on this api instance.");
					return;
				}
				setBootError(err instanceof Error ? err.message : String(err));
			}
		})();
	}, []);

	// Once gated in, load stats + first page of users.
	useEffect(() => {
		if (!me) return;
		void refreshStats();
		void refreshUsers(0, search, tierFilter, roleFilter);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [me]);

	async function refreshStats() {
		try {
			const s = await apiFetch<Stats>("/v1/admin/stats");
			setStats(s);
		} catch (err) {
			toast.error(`Stats failed: ${(err as Error).message}`);
		}
	}

	async function refreshUsers(nextPage: number, q: string, t: "" | Tier, r: "" | Role) {
		setListLoading(true);
		try {
			const params = new URLSearchParams();
			if (q) params.set("q", q);
			if (t) params.set("tier", t);
			if (r) params.set("role", r);
			params.set("limit", String(PAGE_SIZE));
			params.set("offset", String(nextPage * PAGE_SIZE));
			const res = await apiFetch<UserList>(`/v1/admin/users?${params.toString()}`);
			setList(res);
			setPage(nextPage);
		} catch (err) {
			toast.error(`Users failed: ${(err as Error).message}`);
		} finally {
			setListLoading(false);
		}
	}

	async function loadDetail(id: string) {
		setSelectedId(id);
		setDetailLoading(true);
		setDetail(null);
		try {
			const d = await apiFetch<UserDetail>(`/v1/admin/users/${encodeURIComponent(id)}`);
			setDetail(d);
		} catch (err) {
			toast.error(`Detail failed: ${(err as Error).message}`);
			setSelectedId(null);
		} finally {
			setDetailLoading(false);
		}
	}

	async function refreshAfterMutation() {
		await Promise.all([
			refreshStats(),
			refreshUsers(page, search, tierFilter, roleFilter),
			selectedId
				? apiFetch<UserDetail>(`/v1/admin/users/${encodeURIComponent(selectedId)}`).then(setDetail).catch(() => {})
				: Promise.resolve(),
		]);
	}

	function onSubmitSearch(e: React.FormEvent) {
		e.preventDefault();
		void refreshUsers(0, search, tierFilter, roleFilter);
	}

	if (bootError) {
		return <div className="admin-fatal"><p>{bootError}</p></div>;
	}
	if (!me) {
		return <div className="admin-loading"><p>Loading…</p></div>;
	}

	return (
		<div className="admin-app">
			<Toaster richColors position="top-right" />

			<header className="admin-top">
				<div className="admin-top-left">
					<a href="/dashboard/" className="admin-back">← Dashboard</a>
					<h1 className="admin-title">Admin</h1>
				</div>
				<div className="admin-top-right">
					<span className="admin-me">{me.email}</span>
				</div>
			</header>

			{stats && <StatsStrip stats={stats} />}

			<div className="admin-grid">
				<section className="admin-list-pane">
					<form className="admin-filters" onSubmit={onSubmitSearch}>
						<input
							className="admin-input"
							type="search"
							placeholder="Search email or name…"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
						/>
						<FormSelect
							value={tierFilter}
							options={TIER_FILTER_OPTIONS}
							onChange={(v) => {
								setTierFilter(v as "" | Tier);
								void refreshUsers(0, search, v as "" | Tier, roleFilter);
							}}
							width={140}
						/>
						<FormSelect
							value={roleFilter}
							options={ROLE_FILTER_OPTIONS}
							onChange={(v) => {
								setRoleFilter(v as "" | Role);
								void refreshUsers(0, search, tierFilter, v as "" | Role);
							}}
							width={140}
						/>
						<button type="submit" className="admin-btn">Search</button>
					</form>

					<UserTable
						list={list}
						loading={listLoading}
						selectedId={selectedId}
						onSelect={loadDetail}
					/>

					{list && list.total > PAGE_SIZE && (
						<Pager
							page={page}
							total={list.total}
							pageSize={PAGE_SIZE}
							onPage={(p) => refreshUsers(p, search, tierFilter, roleFilter)}
						/>
					)}
				</section>

				<section className="admin-detail-pane">
					{!selectedId && <div className="admin-detail-empty">Select a user to inspect.</div>}
					{selectedId && detailLoading && <div className="admin-detail-empty">Loading…</div>}
					{selectedId && !detailLoading && detail && (
						<UserDetailPanel
							detail={detail}
							onMutated={refreshAfterMutation}
							onClose={() => {
								setSelectedId(null);
								setDetail(null);
							}}
						/>
					)}
				</section>
			</div>
		</div>
	);
}

/* ---------------------------------- stats --------------------------------- */

function StatsStrip({ stats }: { stats: Stats }) {
	return (
		<div className="admin-stats">
			<div className="admin-stat">
				<div className="admin-stat-label">Users</div>
				<div className="admin-stat-value">{fmt(stats.users.total)}</div>
				<div className="admin-tier-row">
					{TIERS.map((t) => (
						<span key={t}>
							{t}<b>{fmt(stats.users.byTier[t] ?? 0)}</b>
						</span>
					))}
				</div>
			</div>
			<Stat label="New · 30d" value={fmt(stats.users.signedUpLast30d)} sub={`${fmt(stats.users.admins)} admins`} />
			<Stat label="Active keys" value={fmt(stats.keys.active)} sub={`${fmt(stats.keys.revoked)} revoked`} />
			<Stat
				label="Active grants"
				value={fmt(stats.grants.active)}
				sub={`+${fmt(stats.grants.activeBonusCredits)} cr · ${stats.grants.grantedLast30d} new · 30d`}
			/>
			<Stat
				label="Credits · month"
				value={fmt(stats.usage.creditsThisMonth)}
				sub={`${fmt(stats.usage.callsThisMonth)} calls`}
			/>
		</div>
	);
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
	return (
		<div className="admin-stat">
			<div className="admin-stat-label">{label}</div>
			<div className="admin-stat-value">{value}</div>
			{sub && <div className="admin-stat-sub">{sub}</div>}
		</div>
	);
}

/* ----------------------------------- table -------------------------------- */

function UserTable({
	list,
	loading,
	selectedId,
	onSelect,
}: {
	list: UserList | null;
	loading: boolean;
	selectedId: string | null;
	onSelect: (id: string) => void;
}) {
	if (loading && !list) {
		return <div className="admin-list-empty">Loading…</div>;
	}
	if (!list || list.users.length === 0) {
		return <div className="admin-list-empty">No users match.</div>;
	}
	return (
		<div className="admin-table-wrap">
			<table className="admin-table">
				<thead>
					<tr>
						<th>User</th>
						<th>Tier</th>
						<th>Role</th>
						<th className="admin-num">Credits</th>
						<th className="admin-num">Keys</th>
						<th>Last active</th>
					</tr>
				</thead>
				<tbody>
					{list.users.map((u) => (
						<tr
							key={u.id}
							className={u.id === selectedId ? "admin-row admin-row--active" : "admin-row"}
							onClick={() => onSelect(u.id)}
						>
							<td>
								<div className="admin-user-cell">
									{u.image ? (
										<img src={u.image} alt="" className="admin-avatar" />
									) : (
										<span className="admin-avatar admin-avatar--fallback">
											{u.name?.[0]?.toUpperCase() ?? u.email[0]?.toUpperCase() ?? "?"}
										</span>
									)}
									<div className="admin-user-cell-text">
										<div className="admin-user-cell-name">{u.name || u.email}</div>
										<div className="admin-user-cell-email">{u.email}</div>
									</div>
								</div>
							</td>
							<td><Pill kind={`tier-${u.tier}`}>{u.tier}</Pill></td>
							<td>{u.role === "admin" ? <Pill kind="role-admin">admin</Pill> : <span className="admin-muted">user</span>}</td>
							<td className="admin-num">
								<div>{fmt(u.creditsUsed)} / {fmt(u.creditsLimit)}</div>
								{u.bonusCredits !== 0 && (
									<div className={u.bonusCredits > 0 ? "admin-bonus admin-bonus--pos" : "admin-bonus admin-bonus--neg"}>
										{u.bonusCredits > 0 ? "+" : ""}{fmt(u.bonusCredits)} bonus
									</div>
								)}
							</td>
							<td className="admin-num">{u.activeKeyCount}</td>
							<td className="admin-muted">{u.lastActiveAt ? fmtRelative(u.lastActiveAt) : "—"}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function Pager({
	page,
	total,
	pageSize,
	onPage,
}: {
	page: number;
	total: number;
	pageSize: number;
	onPage: (p: number) => void;
}) {
	const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);
	return (
		<div className="admin-pager">
			<button className="admin-btn" disabled={page === 0} onClick={() => onPage(page - 1)}>
				← Prev
			</button>
			<span className="admin-pager-info">
				Page {page + 1} of {lastPage + 1} · {fmt(total)} users
			</span>
			<button className="admin-btn" disabled={page >= lastPage} onClick={() => onPage(page + 1)}>
				Next →
			</button>
		</div>
	);
}

/* ---------------------------------- detail -------------------------------- */

function UserDetailPanel({
	detail,
	onMutated,
	onClose,
}: {
	detail: UserDetail;
	onMutated: () => Promise<void>;
	onClose: () => void;
}) {
	const u = detail.user;
	const [tierDraft, setTierDraft] = useState<Tier>(u.tier);
	const [roleDraft, setRoleDraft] = useState<Role>(u.role);
	const [savingPatch, setSavingPatch] = useState(false);

	const [grantAmount, setGrantAmount] = useState<string>("1000");
	const [grantReason, setGrantReason] = useState("");
	const [grantExpiry, setGrantExpiry] = useState<Expiry>("none");
	const [grantSubmitting, setGrantSubmitting] = useState(false);

	const [issued, setIssued] = useState<{ plaintext: string; prefix: string } | null>(null);

	// Radix Dialog drives the three destructive / prompting flows below;
	// `*Target` carries the row being acted on, `dialogPending` locks
	// the action button while the API call is in-flight.
	const [revokeGrantTarget, setRevokeGrantTarget] = useState<Grant | null>(null);
	const [revokeGrantReason, setRevokeGrantReason] = useState("");
	const [revokeKeyTarget, setRevokeKeyTarget] = useState<Key | null>(null);
	const [issueKeyOpen, setIssueKeyOpen] = useState(false);
	const [issueKeyName, setIssueKeyName] = useState("");
	const [dialogPending, setDialogPending] = useState(false);

	useEffect(() => {
		setTierDraft(u.tier);
		setRoleDraft(u.role);
		setIssued(null);
		setGrantReason("");
		setGrantAmount("1000");
		setGrantExpiry("none");
		setRevokeGrantTarget(null);
		setRevokeGrantReason("");
		setRevokeKeyTarget(null);
		setIssueKeyOpen(false);
		setIssueKeyName("");
	}, [u.id]);

	const dirty = tierDraft !== u.tier || roleDraft !== u.role;

	async function savePatch() {
		setSavingPatch(true);
		try {
			await apiFetch<UserDetail>(`/v1/admin/users/${encodeURIComponent(u.id)}`, {
				method: "PATCH",
				body: JSON.stringify({
					tier: tierDraft !== u.tier ? tierDraft : undefined,
					role: roleDraft !== u.role ? roleDraft : undefined,
				}),
			});
			toast.success("Saved.");
			await onMutated();
		} catch (err) {
			toast.error((err as Error).message);
		} finally {
			setSavingPatch(false);
		}
	}

	async function grantCredits(e: React.FormEvent) {
		e.preventDefault();
		const delta = Number.parseInt(grantAmount, 10);
		if (!Number.isFinite(delta) || delta === 0) {
			toast.error("Enter a non-zero integer.");
			return;
		}
		if (!grantReason.trim()) {
			toast.error("Reason is required.");
			return;
		}
		setGrantSubmitting(true);
		try {
			await apiFetch(`/v1/admin/users/${encodeURIComponent(u.id)}/credits`, {
				method: "POST",
				body: JSON.stringify({
					creditsDelta: delta,
					reason: grantReason.trim(),
					expiresAt: computeExpiry(grantExpiry),
				}),
			});
			toast.success(`${delta > 0 ? "Granted" : "Clawed back"} ${fmt(Math.abs(delta))} credits.`);
			setGrantReason("");
			await onMutated();
		} catch (err) {
			toast.error((err as Error).message);
		} finally {
			setGrantSubmitting(false);
		}
	}

	async function performRevokeGrant() {
		if (!revokeGrantTarget) return;
		setDialogPending(true);
		try {
			const reason = revokeGrantReason.trim();
			await apiFetch(`/v1/admin/grants/${encodeURIComponent(revokeGrantTarget.id)}`, {
				method: "DELETE",
				body: JSON.stringify({ reason: reason || undefined }),
			});
			toast.success("Grant revoked.");
			setRevokeGrantTarget(null);
			setRevokeGrantReason("");
			await onMutated();
		} catch (err) {
			toast.error((err as Error).message);
		} finally {
			setDialogPending(false);
		}
	}

	async function performIssueKey() {
		setDialogPending(true);
		try {
			const name = issueKeyName.trim();
			const res = await apiFetch<{ plaintext: string; prefix: string }>(
				`/v1/admin/users/${encodeURIComponent(u.id)}/keys`,
				{ method: "POST", body: JSON.stringify({ name: name || undefined }) },
			);
			setIssued(res);
			toast.success("Key issued. Copy now — it will not be shown again.");
			setIssueKeyOpen(false);
			setIssueKeyName("");
			await onMutated();
		} catch (err) {
			toast.error((err as Error).message);
		} finally {
			setDialogPending(false);
		}
	}

	async function performRevokeKey() {
		if (!revokeKeyTarget) return;
		setDialogPending(true);
		try {
			await apiFetch(`/v1/admin/keys/${encodeURIComponent(revokeKeyTarget.id)}`, { method: "DELETE" });
			toast.success("Key revoked.");
			setRevokeKeyTarget(null);
			await onMutated();
		} catch (err) {
			toast.error((err as Error).message);
		} finally {
			setDialogPending(false);
		}
	}

	return (
		<div className="admin-detail">
			<div className="admin-detail-head">
				<div>
					<div className="admin-detail-title">{u.name || u.email}</div>
					<div className="admin-detail-subtitle">{u.email} · joined {fmtDate(u.createdAt)}</div>
				</div>
				<button className="admin-icon-btn" aria-label="Close" onClick={onClose}>×</button>
			</div>

			<div className="admin-detail-summary">
				<MetricBlock label="Credits used" value={`${fmt(detail.usage.creditsUsed)} / ${fmt(detail.usage.creditsLimit)}`} sub={detail.usage.bonusCredits !== 0 ? `${detail.usage.bonusCredits > 0 ? "+" : ""}${fmt(detail.usage.bonusCredits)} bonus` : "no bonus"} />
				<MetricBlock label="Active keys" value={String(u.activeKeyCount)} />
				<MetricBlock label="Last active" value={u.lastActiveAt ? fmtRelative(u.lastActiveAt) : "never"} />
				<MetricBlock label="Verified" value={u.emailVerified ? "yes" : "no"} />
			</div>

			<section className="admin-section">
				<h3 className="admin-section-title">Tier &amp; role</h3>
				<div className="admin-patch-row">
					<LabeledField label="Tier">
						{(id) => (
							<FormSelect
								value={tierDraft}
								options={TIER_OPTIONS}
								onChange={(v) => setTierDraft(v as Tier)}
								width={140}
								aria-labelledby={id}
							/>
						)}
					</LabeledField>
					<LabeledField label="Role">
						{(id) => (
							<FormSelect
								value={roleDraft}
								options={ROLE_OPTIONS}
								onChange={(v) => setRoleDraft(v as Role)}
								width={140}
								aria-labelledby={id}
							/>
						)}
					</LabeledField>
					<button className="admin-btn admin-btn--primary" disabled={!dirty || savingPatch} onClick={savePatch}>
						{savingPatch ? "Saving…" : "Save"}
					</button>
				</div>
				<p className="admin-hint">
					Tier overrides do not touch Stripe. To revert, change again.
					Role changes take effect on the user's next session resolution.
				</p>
			</section>

			<section className="admin-section">
				<h3 className="admin-section-title">Grant credits</h3>
				<form className="admin-grant-form" onSubmit={grantCredits}>
					<label className="admin-field admin-field--amount">
						<span>Amount</span>
						<input
							className="admin-input"
							type="number"
							step="100"
							value={grantAmount}
							onChange={(e) => setGrantAmount(e.target.value)}
							placeholder="1000 (or -500 to claw back)"
						/>
					</label>
					<LabeledField label="Expires" className="admin-field--expires">
						{(id) => (
							<FormSelect
								value={grantExpiry}
								options={EXPIRY_OPTIONS}
								onChange={(v) => setGrantExpiry(v as Expiry)}
								width="100%"
								aria-labelledby={id}
							/>
						)}
					</LabeledField>
					<button
						className="admin-btn admin-btn--primary admin-grant-submit"
						type="submit"
						disabled={grantSubmitting}
					>
						{grantSubmitting ? "Granting…" : "Grant"}
					</button>
					<label className="admin-field admin-field--reason">
						<span>Reason</span>
						<input
							className="admin-input"
							value={grantReason}
							onChange={(e) => setGrantReason(e.target.value)}
							placeholder="e.g. design partner, conf credit, refund"
							maxLength={280}
						/>
					</label>
				</form>

				<div className="admin-subhead">
					<span>History</span>
					<span className="admin-muted">{detail.grants.length} total</span>
				</div>
				{detail.grants.length === 0 ? (
					<div className="admin-list-empty">No grants yet.</div>
				) : (
					<table className="admin-table admin-table--compact">
						<thead>
							<tr>
								<th>When</th>
								<th className="admin-num">Δ credits</th>
								<th>Reason</th>
								<th>Expires</th>
								<th>By</th>
								<th>Status</th>
								<th></th>
							</tr>
						</thead>
						<tbody>
							{detail.grants.map((g) => (
								<tr key={g.id}>
									<td className="admin-muted">{fmtDate(g.createdAt)}</td>
									<td className={g.creditsDelta > 0 ? "admin-num admin-bonus--pos" : "admin-num admin-bonus--neg"}>
										{g.creditsDelta > 0 ? "+" : ""}{fmt(g.creditsDelta)}
									</td>
									<td>{g.reason}</td>
									<td className="admin-muted">{g.expiresAt ? fmtDate(g.expiresAt) : "never"}</td>
									<td className="admin-muted">{g.grantedByEmail ?? "—"}</td>
									<td>
										{g.active ? (
											<Pill kind="grant-active">active</Pill>
										) : g.revokedAt ? (
											<Pill kind="grant-revoked">revoked</Pill>
										) : (
											<Pill kind="grant-expired">expired</Pill>
										)}
									</td>
									<td>
										{g.active && (
											<button className="admin-link-btn" onClick={() => setRevokeGrantTarget(g)}>Revoke</button>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</section>

			<section className="admin-section">
				<div className="admin-section-head">
					<h3 className="admin-section-title">API keys</h3>
					<button className="admin-btn" onClick={() => setIssueKeyOpen(true)}>
						Issue key
					</button>
				</div>
				{issued && (
					<div className="admin-issued">
						<div className="admin-issued-label">Plaintext (shown once)</div>
						<code className="admin-issued-code">{issued.plaintext}</code>
						<button
							className="admin-btn admin-btn--small"
							onClick={() => {
								navigator.clipboard.writeText(issued.plaintext);
								toast.success("Copied.");
							}}
						>
							Copy
						</button>
					</div>
				)}
				{detail.keys.length === 0 ? (
					<div className="admin-list-empty">No keys.</div>
				) : (
					<table className="admin-table admin-table--compact">
						<thead>
							<tr>
								<th>Name</th>
								<th>Prefix</th>
								<th>Tier</th>
								<th>Created</th>
								<th>Last used</th>
								<th>Status</th>
								<th></th>
							</tr>
						</thead>
						<tbody>
							{detail.keys.map((k) => (
								<tr key={k.id}>
									<td>{k.name ?? "—"}</td>
									<td><code className="admin-key-prefix">{k.prefix}…{k.suffix ?? ""}</code></td>
									<td><Pill kind={`tier-${k.tier}`}>{k.tier}</Pill></td>
									<td className="admin-muted">{fmtDate(k.createdAt)}</td>
									<td className="admin-muted">{k.lastUsedAt ? fmtRelative(k.lastUsedAt) : "never"}</td>
									<td>
										{k.revokedAt ? <Pill kind="grant-revoked">revoked</Pill> : <Pill kind="grant-active">active</Pill>}
									</td>
									<td>
										{!k.revokedAt && (
											<button className="admin-link-btn" onClick={() => setRevokeKeyTarget(k)}>Revoke</button>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</section>

			<ConfirmDialog
				open={revokeGrantTarget != null}
				onOpenChange={(o) => {
					if (!o) {
						setRevokeGrantTarget(null);
						setRevokeGrantReason("");
					}
				}}
				title="Revoke grant?"
				description={
					revokeGrantTarget
						? `${revokeGrantTarget.creditsDelta > 0 ? "+" : ""}${fmt(revokeGrantTarget.creditsDelta)} credits — “${revokeGrantTarget.reason}”. The user's effective limit drops immediately.`
						: undefined
				}
				confirmLabel="Revoke"
				confirmKind="danger"
				pending={dialogPending}
				onConfirm={performRevokeGrant}
			>
				<input
					className="rx-dialog-input"
					autoFocus
					value={revokeGrantReason}
					onChange={(e) => setRevokeGrantReason(e.target.value)}
					placeholder="Optional revoke reason"
					maxLength={280}
				/>
			</ConfirmDialog>

			<ConfirmDialog
				open={revokeKeyTarget != null}
				onOpenChange={(o) => {
					if (!o) setRevokeKeyTarget(null);
				}}
				title="Revoke key?"
				description={
					revokeKeyTarget
						? `${revokeKeyTarget.prefix}…${revokeKeyTarget.suffix ?? ""} — any client using it will start getting 401 immediately.`
						: undefined
				}
				confirmLabel="Revoke"
				confirmKind="danger"
				pending={dialogPending}
				onConfirm={performRevokeKey}
			/>

			<ConfirmDialog
				open={issueKeyOpen}
				onOpenChange={(o) => {
					if (!o) {
						setIssueKeyOpen(false);
						setIssueKeyName("");
					}
				}}
				title="Issue API key"
				description="The plaintext is shown once after issuance. The user inherits the key's tier from their current account tier."
				confirmLabel="Issue"
				confirmKind="primary"
				pending={dialogPending}
				onConfirm={performIssueKey}
			>
				<input
					className="rx-dialog-input"
					autoFocus
					value={issueKeyName}
					onChange={(e) => setIssueKeyName(e.target.value)}
					placeholder="Optional key name (e.g. “laptop”)"
					maxLength={120}
				/>
			</ConfirmDialog>
		</div>
	);
}

/* --------------------------------- helpers -------------------------------- */

function MetricBlock({ label, value, sub }: { label: string; value: string; sub?: string }) {
	return (
		<div className="admin-metric">
			<div className="admin-metric-label">{label}</div>
			<div className="admin-metric-value">{value}</div>
			{sub && <div className="admin-metric-sub">{sub}</div>}
		</div>
	);
}

function Pill({ kind, children }: { kind: string; children: React.ReactNode }) {
	return <span className={`admin-pill admin-pill--${kind}`}>{children}</span>;
}

/**
 * Stacked label + control. Uses a span+id (not <label htmlFor>) because
 * the control may be a Radix Select, whose trigger isn't a real form
 * element — `aria-labelledby` is the correct wire-up.
 */
function LabeledField({
	label,
	className,
	children,
}: {
	label: ReactNode;
	className?: string;
	children: (labelId: string) => ReactNode;
}) {
	const id = useId();
	const labelId = `${id}-label`;
	return (
		<div className={className ? `admin-field ${className}` : "admin-field"}>
			<span id={labelId}>{label}</span>
			{children(labelId)}
		</div>
	);
}

/**
 * Generic confirm dialog backed by Radix Dialog. Optional `children`
 * slot lets the caller drop a prompt input (revoke reason, key name)
 * between the description and the action row.
 */
function ConfirmDialog({
	open,
	onOpenChange,
	title,
	description,
	confirmLabel,
	confirmKind = "primary",
	pending,
	onConfirm,
	children,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description?: ReactNode;
	confirmLabel: string;
	confirmKind?: "primary" | "danger";
	pending: boolean;
	onConfirm: () => void;
	children?: ReactNode;
}) {
	return (
		<RxDialog.Root open={open} onOpenChange={onOpenChange}>
			<RxDialog.Portal>
				<RxDialog.Overlay className="rx-dialog-overlay" />
				<RxDialog.Content className="rx-dialog-content">
					<RxDialog.Title className="rx-dialog-title">{title}</RxDialog.Title>
					{description && (
						<RxDialog.Description className="rx-dialog-desc">{description}</RxDialog.Description>
					)}
					{children}
					<div className="rx-dialog-actions">
						<RxDialog.Close asChild>
							<button type="button" className="rx-dialog-btn">Cancel</button>
						</RxDialog.Close>
						<button
							type="button"
							className={`rx-dialog-btn rx-dialog-btn-${confirmKind}`}
							disabled={pending}
							onClick={onConfirm}
						>
							{pending ? "Working…" : confirmLabel}
						</button>
					</div>
				</RxDialog.Content>
			</RxDialog.Portal>
		</RxDialog.Root>
	);
}

function fmt(n: number): string {
	return new Intl.NumberFormat("en-US").format(n);
}

function fmtDate(iso: string): string {
	return new Date(iso).toISOString().slice(0, 10);
}

function fmtRelative(iso: string): string {
	const ms = Date.now() - new Date(iso).getTime();
	const min = Math.round(ms / 60_000);
	if (min < 1) return "just now";
	if (min < 60) return `${min}m ago`;
	const hr = Math.round(min / 60);
	if (hr < 24) return `${hr}h ago`;
	const d = Math.round(hr / 24);
	if (d < 30) return `${d}d ago`;
	return fmtDate(iso);
}

function computeExpiry(choice: "none" | "this_month" | "30d" | "90d"): string | null {
	if (choice === "none") return null;
	const now = new Date();
	if (choice === "this_month") {
		return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
	}
	const days = choice === "30d" ? 30 : 90;
	return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}
