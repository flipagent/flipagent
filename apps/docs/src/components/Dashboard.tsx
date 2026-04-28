/**
 * Dashboard shell — sidebar + main content. Single-page React app gated by
 * Better-Auth session. The sidebar drives a `view` state; each panel shares
 * the same `profile`, `keys`, and `ebay` data fetched on mount.
 *
 * Views:
 *   overview  → endpoint cards + API key + agent integrations + recent usage
 *   playground/* → small forms that hit the real eBay-compat endpoints
 *   keys      → CRUD against /v1/me/keys
 *   usage     → monthly counter + (future) per-endpoint breakdown
 *   ebay      → connect / status / disconnect
 *   billing   → upgrade buttons + Stripe portal
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import { CHANGELOG, type ChangelogEntry, type ChangelogTag } from "../data/changelog";
import { apiBase, apiFetch, authClient, signOut } from "../lib/authClient";
import type { ComposeTab } from "./compose/ComposeCard";
import { PlaygroundDiscover } from "./playground/PlaygroundDiscover";
import { PlaygroundEvaluate } from "./playground/PlaygroundEvaluate";
import "./Dashboard.css";
import "./ui/ui.css";
import "./playground/Playground.css";

type Tier = "free" | "hobby" | "pro" | "business";

type View =
	| "overview"
	| "playground/discover"
	| "playground/evaluate"
	| "keys"
	| "usage"
	| "activity"
	| "ebay"
	| "billing"
	| "integrations"
	| "whatsnew";

type Profile = {
	id: string;
	email: string;
	name: string;
	image: string | null;
	tier: Tier;
	emailVerified: boolean;
	usage: { used: number; limit: number | null; remaining: number | null; resetAt: string };
};
type KeyRow = {
	id: string;
	name: string | null;
	prefix: string;
	tier: Tier;
	createdAt: string;
	lastUsedAt: string | null;
};
type IssuedKey = { id: string; tier: Tier; prefix: string; plaintext: string; notice: string };
type EbayStatus =
	| { connected: false }
	| {
			connected: true;
			ebayUserId: string | null;
			ebayUserName: string | null;
			scopes: string[];
			accessTokenExpiresAt: string;
			connectedAt: string;
	  };
type Toast = { kind: "success" | "error"; message: string };

/**
 * Capability snapshot from `/v1/health/features`. Drives panel visibility so
 * a self-hosted instance with Stripe / GitHub OAuth / eBay env unset doesn't
 * show buttons that 503 on click. Defaults to "everything on" while we wait
 * for the response (hosted = the common case; first-paint shouldn't flicker).
 */
type Features = {
	ebayOAuth: boolean;
	orderApi: boolean;
	insightsApi: boolean;
	scrapeProxy: boolean;
	betterAuth: boolean;
	googleOAuth: boolean;
	email: boolean;
	stripe: boolean;
};
const DEFAULT_FEATURES: Features = {
	ebayOAuth: true,
	orderApi: false,
	insightsApi: false,
	scrapeProxy: true,
	betterAuth: true,
	googleOAuth: true,
	email: true,
	stripe: true,
};

type ScopeStatus = "ok" | "scrape_fallback" | "needs_oauth" | "approval_pending" | "unavailable";
type Permissions = {
	ebayConnected: boolean;
	ebayUserName: string | null;
	ebayUserId: string | null;
	scopes: {
		browse: ScopeStatus;
		marketplaceInsights: ScopeStatus;
		inventory: ScopeStatus;
		fulfillment: ScopeStatus;
		finance: ScopeStatus;
		orderApi: ScopeStatus;
	};
};

export default function Dashboard() {
	const [view, setView] = useState<View>("overview");
	const [profile, setProfile] = useState<Profile | null>(null);
	const [keys, setKeys] = useState<KeyRow[]>([]);
	const [ebay, setEbay] = useState<EbayStatus | null>(null);
	const [permissions, setPermissions] = useState<Permissions | null>(null);
	// Cross-link from Discover → Evaluate: Discover passes the row's
	// itemId here, we navigate to evaluate; the panel reads it as its
	// initial input and auto-runs.
	const [evaluateSeed, setEvaluateSeed] = useState<string | null>(null);
	const [features, setFeatures] = useState<Features>(DEFAULT_FEATURES);
	const [issued, setIssued] = useState<IssuedKey | null>(null);
	const [toast, setToast] = useState<Toast | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [collapsed, setCollapsed] = useState(false);

	async function refreshKeys() {
		const list = await apiFetch<{ keys: KeyRow[] }>("/v1/me/keys");
		setKeys(list.keys);
	}
	async function refreshEbay() {
		try {
			const status = await apiFetch<EbayStatus>("/v1/me/ebay/status");
			setEbay(status);
		} catch {
			setEbay({ connected: false });
		}
	}
	async function refreshPermissions() {
		try {
			const p = await apiFetch<Permissions>("/v1/me/permissions");
			setPermissions(p);
		} catch {
			/* permissions is advisory — leave stale on transient failure */
		}
	}
	async function refreshProfile() {
		try {
			const me = await apiFetch<Profile>("/v1/me");
			setProfile(me);
		} catch {
			/* keep stale on transient failure */
		}
	}

	useEffect(() => {
		// Features is public + cheap. Fetch in parallel with profile so panels
		// get capability info before they mount.
		(async () => {
			try {
				const f = await apiFetch<Features>("/v1/health/features");
				setFeatures(f);
			} catch {
				/* keep DEFAULT_FEATURES — better to over-show than under-show */
			}
		})();
		(async () => {
			try {
				const me = await apiFetch<Profile>("/v1/me");
				setProfile(me);
				await Promise.all([refreshKeys(), refreshEbay(), refreshPermissions()]);
			} catch (err) {
				const status = (err as { status?: number }).status;
				if (status === 401) {
					window.location.href = "/signup/";
					return;
				}
				if (status === 503) {
					setError("Auth isn't configured on this api instance yet.");
					return;
				}
				setError(err instanceof Error ? err.message : String(err));
			}
		})();

		// Post-OAuth + verify-email return params
		const p = new URLSearchParams(window.location.search);
		const ebayParam = p.get("ebay");
		const verified = p.get("verified");
		if (ebayParam === "connected") {
			const u = p.get("user");
			setToast({ kind: "success", message: u ? `Connected as @${u}.` : "eBay account connected." });
			window.history.replaceState({}, "", window.location.pathname);
		} else if (ebayParam === "error") {
			setToast({ kind: "error", message: p.get("message") ?? "eBay connection failed." });
			window.history.replaceState({}, "", window.location.pathname);
		} else if (verified === "1" || verified === "true") {
			setToast({ kind: "success", message: "Email verified." });
			window.history.replaceState({}, "", window.location.pathname);
		}
	}, []);

	if (error && !profile) {
		return <div className="dash-fatal"><p>{error}</p></div>;
	}
	if (!profile) {
		return <div className="dash-loading"><p>Loading…</p></div>;
	}

	return (
		<div className={`dash-app ${collapsed ? "dash-app--collapsed" : ""}`}>
			<Sidebar
				view={view}
				setView={setView}
				profile={profile}
				collapsed={collapsed}
				onToggle={() => setCollapsed((v) => !v)}
			/>
			{!profile.emailVerified && (
				<EmailVerifyBanner email={profile.email} onToast={setToast} />
			)}
			<main className="dash-main">
				<TopBar
					tier={profile.tier}
					ebay={ebay}
					onUpgrade={() => setView("billing")}
					onEbay={() => setView("ebay")}
				/>
				<div className="dash-content">
					{view === "overview" && (
						<Overview
							profile={profile}
							keys={keys}
							ebay={ebay}
							onGoto={setView}
							refreshProfile={refreshProfile}
						/>
					)}
					{(view === "playground/discover" || view === "playground/evaluate") && (
						<PlaygroundShell
							active={view === "playground/discover" ? "discover" : "evaluate"}
							onChange={(next) => setView(next === "discover" ? "playground/discover" : "playground/evaluate")}
							evaluateSeed={evaluateSeed}
							onEvaluate={(itemId) => {
								setEvaluateSeed(itemId);
								setView("playground/evaluate");
							}}
						/>
					)}
					{view === "keys" && (
						<KeysPanel
							keys={keys}
							issued={issued}
							setIssued={setIssued}
							refresh={refreshKeys}
							onError={setError}
						/>
					)}
					{view === "usage" && <UsagePanel profile={profile} />}
					{view === "activity" && <ActivityPanel />}
					{view === "ebay" && (
						<EbayPanel
							ebay={ebay}
							keys={keys}
							features={features}
							permissions={permissions}
							refresh={async () => {
								await Promise.all([refreshEbay(), refreshPermissions()]);
							}}
							onToast={setToast}
						/>
					)}
					{view === "billing" && <BillingPanel tier={profile.tier} features={features} onError={setError} />}
					{view === "integrations" && <IntegrationsPanel keys={keys} features={features} />}
					{view === "whatsnew" && <WhatsNewPanel />}
				</div>
			</main>

			{toast && (
				<div className={`dash-toast dash-toast--${toast.kind}`}>
					<span>{toast.message}</span>
					<button type="button" aria-label="Dismiss" onClick={() => setToast(null)}>×</button>
				</div>
			)}
		</div>
	);
}

/* ─────────── What's New ─────────── */

const WHATSNEW_LAST_READ_KEY = "flipagent.whatsnewLastRead";
const TAG_LABEL: Record<ChangelogTag, string> = {
	feature: "Feature",
	improvement: "Improvement",
	fix: "Fix",
	infra: "Infra",
};

function useUnreadChangelogCount(): number {
	const [lastRead, setLastRead] = useState<string | null>(null);
	useEffect(() => {
		try {
			setLastRead(localStorage.getItem(WHATSNEW_LAST_READ_KEY));
		} catch {
			/* no-op */
		}
		const onStorage = () => {
			try {
				setLastRead(localStorage.getItem(WHATSNEW_LAST_READ_KEY));
			} catch {
				/* no-op */
			}
		};
		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	}, []);
	return useMemo(() => {
		if (!lastRead) return CHANGELOG.length;
		return CHANGELOG.filter((e) => e.date > lastRead).length;
	}, [lastRead]);
}

function markChangelogRead() {
	try {
		const newest = CHANGELOG[0]?.date;
		if (newest) {
			localStorage.setItem(WHATSNEW_LAST_READ_KEY, newest);
			window.dispatchEvent(new Event("storage"));
		}
	} catch {
		/* no-op */
	}
}

function WhatsNewPanel() {
	useEffect(() => {
		// Mark everything as read once the panel opens.
		markChangelogRead();
	}, []);

	return (
		<>
			<section className="dash-page-head">
				<h1>What's New</h1>
				<p>Recent shipped work — newest at the top.</p>
			</section>
			<div className="dash-card">
				<ol className="dash-timeline">
					{CHANGELOG.map((entry, idx) => (
						<TimelineRow key={`${entry.date}-${idx}`} entry={entry} />
					))}
				</ol>
			</div>
		</>
	);
}

function TimelineRow({ entry }: { entry: ChangelogEntry }) {
	return (
		<li className="dash-timeline-row">
			<div className="dash-timeline-marker" aria-hidden="true">
				<span className="dash-timeline-dot" />
				<span className="dash-timeline-line" />
			</div>
			<div className="dash-timeline-body">
				<div className="dash-timeline-meta">
					<span className={`dash-tag dash-tag--${entry.tag}`}>{TAG_LABEL[entry.tag]}</span>
					<span className="dash-timeline-date">{formatDate(entry.date)}</span>
				</div>
				<h3 className="dash-timeline-title">{entry.title}</h3>
				<p className="dash-timeline-text">{entry.body}</p>
			</div>
		</li>
	);
}

function formatDate(iso: string): string {
	try {
		return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
			month: "short",
			day: "numeric",
			year: "numeric",
		});
	} catch {
		return iso;
	}
}

/* ─────────── Email verify banner ─────────── */

function EmailVerifyBanner({ email, onToast }: { email: string; onToast: (t: Toast) => void }) {
	const [pending, setPending] = useState(false);
	const [hidden, setHidden] = useState(false);

	async function resend() {
		setPending(true);
		try {
			await authClient.sendVerificationEmail({
				email,
				callbackURL: `${window.location.origin}/dashboard/?verified=1`,
			});
			onToast({ kind: "success", message: `Verification link re-sent to ${email}.` });
		} catch (err) {
			onToast({ kind: "error", message: err instanceof Error ? err.message : String(err) });
		} finally {
			setPending(false);
		}
	}

	if (hidden) return null;

	return (
		<div className="dash-verify-banner">
			<div className="dash-verify-text">
				<strong>Verify your email.</strong> We sent a link to <code>{email}</code>. Confirm to keep your account active.
			</div>
			<div className="dash-actions">
				<button type="button" className="dash-btn dash-btn--sm" onClick={resend} disabled={pending}>
					{pending ? "Sending…" : "Resend"}
				</button>
				<button type="button" className="dash-btn dash-btn--sm" onClick={() => setHidden(true)} aria-label="Dismiss">×</button>
			</div>
		</div>
	);
}

/* ─────────── Sidebar ─────────── */

function Sidebar({
	view,
	setView,
	profile,
	collapsed,
	onToggle,
}: {
	view: View;
	setView: (v: View) => void;
	profile: Profile;
	collapsed: boolean;
	onToggle: () => void;
}) {
	const [query, setQuery] = useState("");
	const q = query.trim().toLowerCase();
	const matches = (label: string) => !q || label.toLowerCase().includes(q);

	const overviewMatch = matches("Overview");
	const pgItems: { v: View; icon: keyof typeof ICONS; label: string; pill?: string }[] = [
		{ v: "playground/discover", icon: "gauge", label: "Discover deals" },
		{ v: "playground/evaluate", icon: "chart", label: "Evaluate one" },
	];
	const acctItems: { v: View; icon: keyof typeof ICONS; label: string }[] = [
		{ v: "keys", icon: "key", label: "API keys" },
		{ v: "integrations", icon: "doc", label: "Integrations" },
		{ v: "activity", icon: "list", label: "Activity" },
		{ v: "usage", icon: "bar", label: "Usage" },
		{ v: "ebay", icon: "link", label: "eBay account" },
		{ v: "billing", icon: "wallet", label: "Billing" },
	];
	const unread = useUnreadChangelogCount();
	const pgVisible = pgItems.filter((i) => matches(i.label));
	const acctVisible = acctItems.filter((i) => matches(i.label));
	const anyMatch = overviewMatch || pgVisible.length > 0 || acctVisible.length > 0;

	return (
		<aside className="dash-sidebar">
			<a href="/" className="dash-brand">
				<img src="/logo-32.png" width="60" height="18" alt="" aria-hidden="true" />
				{!collapsed && <span>flipagent</span>}
			</a>

			{!collapsed && (
				<div className="dash-sidebar-search">
					<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
						<circle cx="7" cy="7" r="4.5" />
						<path d="m13 13-2.5-2.5" />
					</svg>
					<input
						type="search"
						placeholder="Search…"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
					/>
				</div>
			)}

			<nav className="dash-nav">
				{overviewMatch && (
					<NavItem icon="home" label="Overview" active={view === "overview"} onClick={() => setView("overview")} collapsed={collapsed} />
				)}

				{pgVisible.length > 0 && (
					<>
						<NavGroup label="Playground" collapsed={collapsed} />
						{pgVisible.map((i) => (
							<NavItem key={i.v} icon={i.icon} label={i.label} active={view === i.v} onClick={() => setView(i.v)} collapsed={collapsed} pill={i.pill} />
						))}
					</>
				)}

				{acctVisible.length > 0 && (
					<>
						<NavGroup label="Account" collapsed={collapsed} />
						{acctVisible.map((i) => (
							<NavItem key={i.v} icon={i.icon} label={i.label} active={view === i.v} onClick={() => setView(i.v)} collapsed={collapsed} />
						))}
					</>
				)}

				{!anyMatch && !collapsed && (
					<p className="dash-nav-empty">No matches for "{query}".</p>
				)}
			</nav>

			<div className="dash-sidebar-foot">
				<button
					type="button"
					className={`dash-nav-item dash-whatsnew ${view === "whatsnew" ? "active" : ""}`}
					onClick={() => setView("whatsnew")}
					title="What's New"
				>
					<span className="dash-nav-icon" aria-hidden="true">
						<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
							<path d="M3 6v4l8 4V2L3 6z" />
							<path d="M3 6H1.5v4H3" />
							<circle cx="11.5" cy="8" r="0.5" fill="currentColor" />
						</svg>
					</span>
					{!collapsed && (
						<>
							<span className="dash-nav-label">What's New</span>
							{unread > 0 && <span className="dash-nav-badge">{unread}</span>}
						</>
					)}
				</button>
				<div className="dash-user">
					{profile.image ? (
						<img src={profile.image} alt="" />
					) : (
						<span className="dash-user-avatar">{profile.email[0]?.toUpperCase()}</span>
					)}
					{!collapsed && (
						<div className="dash-user-info">
							<div className="dash-user-name">{profile.name || profile.email}</div>
							<button type="button" className="dash-user-signout" onClick={() => signOut().finally(() => (window.location.href = "/"))}>
								Sign out
							</button>
						</div>
					)}
				</div>
				<button type="button" className="dash-collapse" onClick={onToggle}>
					<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
						{collapsed ? <path d="M6 4l4 4-4 4" /> : <path d="M10 4l-4 4 4 4" />}
					</svg>
					{!collapsed && <span>Collapse</span>}
				</button>
			</div>
		</aside>
	);
}

function NavGroup({ label, collapsed }: { label: string; collapsed: boolean }) {
	if (collapsed) return <div className="dash-nav-divider" />;
	return <div className="dash-nav-group">{label.toUpperCase()}</div>;
}

function NavItem({
	icon,
	label,
	active,
	onClick,
	collapsed,
	pill,
}: {
	icon: keyof typeof ICONS;
	label: string;
	active: boolean;
	onClick: () => void;
	collapsed: boolean;
	pill?: string;
}) {
	return (
		<button type="button" className={`dash-nav-item ${active ? "active" : ""}`} onClick={onClick} title={collapsed ? label : undefined}>
			<span className="dash-nav-icon" aria-hidden="true">{ICONS[icon]}</span>
			{!collapsed && (
				<>
					<span className="dash-nav-label">{label}</span>
					{pill && <span className="dash-nav-pill">{pill}</span>}
				</>
			)}
		</button>
	);
}

const ICONS = {
	home: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 8l6-5 6 5M3 7v6.5h10V7" /></svg>,
	search: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="7" cy="7" r="4.5" /><path d="m13 13-2.5-2.5" /></svg>,
	doc: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 1.5h7L13 4v10.5H3z" /><path d="M10 1.5V4h3M5.5 8h5M5.5 11h5" /></svg>,
	chart: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 13h12M4 13V8M7 13V4M10 13V9M13 13V6" /></svg>,
	gauge: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="5.5" /><path d="M8 8l3-3" /></svg>,
	box: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 5l6-3 6 3v6l-6 3-6-3V5z" /><path d="M2 5l6 3 6-3M8 8v6" /></svg>,
	key: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="5" cy="11" r="2.5" /><path d="M7 9l6-6M11 5l1.5 1.5" /></svg>,
	bar: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 13V3M2.5 13h11M5 11V8M8 11V5M11 11V7" /></svg>,
	list: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4h8M5 8h8M5 12h8" /><circle cx="2.5" cy="4" r="0.5" fill="currentColor" /><circle cx="2.5" cy="8" r="0.5" fill="currentColor" /><circle cx="2.5" cy="12" r="0.5" fill="currentColor" /></svg>,
	link: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6.5 9.5a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5L7.5 5" /><path d="M9.5 6.5a2.5 2.5 0 0 0-3.5 0l-2 2a2.5 2.5 0 0 0 3.5 3.5L8.5 11" /></svg>,
	wallet: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M13 4H4a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 4 13h9z" /><path d="M2.5 5.5h11M10 9h1.5" /></svg>,
};

/* ─────────── Top bar ─────────── */

function TopBar({
	tier,
	ebay,
	onUpgrade,
	onEbay,
}: {
	tier: Tier;
	ebay: EbayStatus | null;
	onUpgrade: () => void;
	onEbay: () => void;
}) {
	return (
		<header className="dash-topbar">
			<div className="dash-topbar-left">
				<span className="dash-tier-pill" data-tier={tier}>{tier.toUpperCase()}</span>
				{ebay && (
					<button
						type="button"
						className={`dash-ebay-pill ${ebay.connected ? "is-connected" : "is-disconnected"}`}
						onClick={onEbay}
						title={ebay.connected ? "Manage eBay connection" : "Connect eBay account"}
					>
						<span className="dash-ebay-dot" aria-hidden="true" />
						<span>
							{ebay.connected
								? `eBay${ebay.ebayUserName ? ` · @${ebay.ebayUserName}` : " · connected"}`
								: "eBay · not connected"}
						</span>
					</button>
				)}
			</div>
			<div className="dash-topbar-right">
				<a href="/docs/" className="dash-topbar-link">Docs</a>
				<a href="mailto:hello@flipagent.dev" className="dash-topbar-link">Help</a>
				{tier === "free" && (
					<button type="button" className="dash-topbar-upgrade" onClick={onUpgrade}>Upgrade</button>
				)}
			</div>
		</header>
	);
}

/* ─────────── Onboarding checklist ─────────── */

const ONBOARDING_DISMISSED_KEY = "flipagent.onboardingDismissed";
const INTEGRATIONS_DONE_KEY = "flipagent.integrationsWired";

function useShowChecklist({
	hasKey,
	hasCall,
	hasEbay,
	hasIntegrations,
}: {
	hasKey: boolean;
	hasCall: boolean;
	hasEbay: boolean;
	hasIntegrations: boolean;
}): boolean {
	const [dismissed, setDismissed] = useState(false);
	useEffect(() => {
		const read = () => {
			try {
				setDismissed(localStorage.getItem(ONBOARDING_DISMISSED_KEY) === "1");
			} catch {
				/* no-op */
			}
		};
		read();
		window.addEventListener("storage", read);
		return () => window.removeEventListener("storage", read);
	}, []);
	if (dismissed) return false;
	return !(hasKey && hasCall && hasEbay && hasIntegrations);
}

/** Reads the user's local "I've wired up an agent" flag. Set when they
 * click through to /integrations and dismiss it (or visit the page once). */
function useIntegrationsDone(): boolean {
	const [done, setDone] = useState(false);
	useEffect(() => {
		const read = () => {
			try {
				setDone(localStorage.getItem(INTEGRATIONS_DONE_KEY) === "1");
			} catch {
				/* no-op */
			}
		};
		read();
		window.addEventListener("storage", read);
		return () => window.removeEventListener("storage", read);
	}, []);
	return done;
}

function OnboardingChecklist({
	hasKey,
	hasCall,
	hasEbay,
	hasIntegrations,
	onGoto,
}: {
	hasKey: boolean;
	hasCall: boolean;
	hasEbay: boolean;
	hasIntegrations: boolean;
	onGoto: (v: View) => void;
}) {
	const requiredDone = hasKey && hasCall;

	function dismiss() {
		try {
			localStorage.setItem(ONBOARDING_DISMISSED_KEY, "1");
		} catch {
			/* no-op */
		}
		// Notify the parent's useShowChecklist hook to re-read the flag.
		window.dispatchEvent(new Event("storage"));
	}

	type Step = {
		done: boolean;
		title: string;
		text: string;
		cta: string;
		view: View;
		optional?: boolean;
		locked?: boolean;
		lockedReason?: string;
	};

	const steps: Step[] = [
		{
			done: hasKey,
			title: "Create your first API key",
			text: "Bearer token scoped to your account. Plaintext is shown once.",
			cta: "Create key",
			view: "keys",
		},
		{
			done: hasCall,
			title: "Make your first API call",
			text: "Run the Discover playground end-to-end, or use the cURL below.",
			cta: "Open Discover",
			view: "playground/discover",
			locked: !hasKey,
			lockedReason: "Create a key first.",
		},
		{
			done: hasEbay,
			title: "Connect your eBay account",
			text: "Unlocks /v1/inventory/*, /v1/fulfillment/*, /v1/finance/*, /v1/orders/*.",
			cta: "Connect",
			view: "ebay",
			optional: true,
			locked: !hasKey,
			lockedReason: "Create a key first.",
		},
		{
			// Always actionable; "done" is set by the user via dismiss when they
			// wire up their agent client. No reliable server-side signal that
			// Claude Desktop / Cursor / SDK is hooked up.
			done: hasIntegrations,
			title: "Wire up your agent",
			text: "One command sets up Claude Desktop, Cursor, and the SDK with your key.",
			cta: "Show me how",
			view: "integrations",
			optional: true,
			locked: !hasKey,
			lockedReason: "Create a key first.",
		},
	];

	const doneCount = steps.filter((s) => s.done).length;
	const firstIncomplete = steps.findIndex((s) => !s.done);

	return (
		<div className="dash-card dash-checklist">
			<div className="dash-checklist-head">
				<div>
					<div className="dash-card-eyebrow">Get started</div>
					<div className="dash-card-h2">
						{doneCount} <span className="dash-of">/ {steps.length} steps complete</span>
					</div>
				</div>
				{requiredDone && (
					<button type="button" className="dash-btn dash-btn--sm" onClick={dismiss}>Hide</button>
				)}
			</div>
			<ol className="dash-checklist-list">
				{steps.map((s, i) => (
					<li key={s.title} className={`dash-checklist-item ${s.done ? "is-done" : ""}`}>
						<span className={`dash-checklist-check ${s.done ? "is-done" : ""}`} aria-hidden="true">
							{s.done ? (
								<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5l3.5 3.5L13 5" /></svg>
							) : (
								i + 1
							)}
						</span>
						<div className="dash-checklist-body">
							<div className="dash-checklist-title">
								<span>{s.title}</span>
								{s.optional && <span className="dash-checklist-pill">Optional</span>}
							</div>
							<div className="dash-checklist-text">{s.text}</div>
						</div>
						{!s.done && (
							<button
								type="button"
								className={`dash-btn ${i === firstIncomplete ? "dash-btn--brand" : ""}`}
								onClick={() => onGoto(s.view)}
								disabled={s.locked}
								title={s.locked ? s.lockedReason : undefined}
							>
								{s.cta}
							</button>
						)}
					</li>
				))}
			</ol>
		</div>
	);
}

/* ─────────── Overview ─────────── */

function Overview({
	profile,
	keys,
	ebay,
	onGoto,
	refreshProfile,
}: {
	profile: Profile;
	keys: KeyRow[];
	ebay: EbayStatus | null;
	onGoto: (v: View) => void;
	refreshProfile: () => Promise<void>;
}) {
	const primaryKey = keys[0];

	// Re-pull profile when Overview mounts so usage.used reflects any
	// playground calls made earlier this session (drives the checklist).
	useEffect(() => {
		refreshProfile();
	}, []);

	const hasKey = keys.length > 0;
	const hasCall = profile.usage.used > 0;
	const hasEbay = ebay?.connected ?? false;
	const hasIntegrations = useIntegrationsDone();
	const showChecklist = useShowChecklist({ hasKey, hasCall, hasEbay, hasIntegrations });
	const showKeyCard = !showChecklist || hasKey;
	const showEbayCard = !showChecklist || hasEbay;

	return (
		<>
			<section className="dash-page-head">
				<h1>Explore your endpoints</h1>
				<p>Hit eBay-compat paths through one bearer token, or run scoring + forwarder math locally.</p>
			</section>

			{showChecklist && (
				<OnboardingChecklist
					hasKey={hasKey}
					hasCall={hasCall}
					hasEbay={hasEbay}
					hasIntegrations={hasIntegrations}
					onGoto={onGoto}
				/>
			)}

			<div className="dash-cards">
				<EndpointCard
					title="Discover deals"
					tag="API"
					body="Sweep a category for under-priced active listings. Ranked by margin × confidence, end-to-end trace."
					onClick={() => onGoto("playground/discover")}
				/>
				<EndpointCard
					title="Evaluate one"
					tag="API"
					body="Drop in any eBay item. Full pipeline: detail → curated comps → market thesis → buy/pass verdict."
					onClick={() => onGoto("playground/evaluate")}
				/>
			</div>

			{(showKeyCard || showEbayCard) && (
				<div className="dash-grid-2">
					{showKeyCard && (
						<div className="dash-card">
							<div className="dash-card-eyebrow">API key</div>
							<div className="dash-card-h2">{primaryKey ? `${primaryKey.prefix}…` : "No key yet"}</div>
							{primaryKey ? (
								<>
									<p className="dash-muted">First created key — use this in the cURL below or your SDK.</p>
									<div className="dash-actions" style={{ marginTop: 12 }}>
										<button type="button" className="dash-btn" onClick={() => onGoto("keys")}>Manage keys</button>
									</div>
								</>
							) : (
								<>
									<p className="dash-muted">Issue one to start hitting the API.</p>
									<div className="dash-actions" style={{ marginTop: 12 }}>
										<button type="button" className="dash-btn dash-btn--brand" onClick={() => onGoto("keys")}>Create a key</button>
									</div>
								</>
							)}
						</div>
					)}

					{showEbayCard && (
						<div className="dash-card">
							<div className="dash-card-eyebrow">eBay account</div>
							<div className="dash-card-h2">
								{ebay?.connected ? `Connected${ebay.ebayUserName ? ` as @${ebay.ebayUserName}` : ""}` : "Not connected"}
							</div>
							{ebay?.connected ? (
								<p className="dash-muted">Sell-side endpoints + Order API (when approved) work through this binding.</p>
							) : (
								<p className="dash-muted">Connect once to unlock <code>/v1/inventory/*</code>, <code>/v1/fulfillment/*</code>, <code>/v1/finance/*</code>, and (when approved) <code>/v1/orders/*</code>.</p>
							)}
							<div className="dash-actions" style={{ marginTop: 12 }}>
								<button type="button" className="dash-btn" onClick={() => onGoto("ebay")}>
									{ebay?.connected ? "Manage" : "Connect eBay"}
								</button>
							</div>
						</div>
					)}
				</div>
			)}

			<div className="dash-card">
				<div className="dash-card-eyebrow">Quick start</div>
				<div className="dash-card-h2">cURL — search canon 50mm</div>
				<pre className="dash-snippet">
					<code>{`curl "${apiBase}/v1/listings/search?q=canon%2050mm&limit=5" \\
  -H "X-API-Key: ${primaryKey ? primaryKey.prefix + "…" : "<YOUR_KEY>"}"`}</code>
				</pre>
			</div>

			<div className="dash-card">
				<div className="dash-card-eyebrow">Agent integrations</div>
				<div className="dash-card-h2">Drop into Claude / Cursor / Cline / Zed</div>
				<pre className="dash-snippet">
					<code>{`{
  "mcpServers": {
    "flipagent": {
      "command": "npx",
      "args": ["-y", "flipagent-mcp"],
      "env": {
        "FLIPAGENT_API_KEY": "${primaryKey ? primaryKey.prefix + "…" : "<YOUR_KEY>"}"
      }
    }
  }
}`}</code>
				</pre>
			</div>

			<div className="dash-card dash-card--inline-stat">
				<div>
					<div className="dash-card-eyebrow">This month</div>
					<div className="dash-card-h2">
						{profile.usage.used.toLocaleString()}
						<span className="dash-of"> / {profile.usage.limit ? profile.usage.limit.toLocaleString() : "∞"} calls</span>
					</div>
				</div>
				<button type="button" className="dash-btn" onClick={() => onGoto("usage")}>Details</button>
			</div>

			<RecentActivityCard onGoto={onGoto} />
		</>
	);
}

function RecentActivityCard({ onGoto }: { onGoto: (v: View) => void }) {
	const [events, setEvents] = useState<EventRow[] | null>(null);
	useEffect(() => {
		(async () => {
			try {
				const res = await apiFetch<{ events: EventRow[] }>("/v1/me/usage/recent");
				setEvents(res.events.slice(0, 5));
			} catch {
				setEvents([]);
			}
		})();
	}, []);

	return (
		<div className="dash-card">
			<div className="dash-card-head">
				<div>
					<div className="dash-card-eyebrow">Recent activity</div>
					<div className="dash-card-h2">{events ? `${events.length} latest calls` : "Loading…"}</div>
				</div>
				<button type="button" className="dash-btn" onClick={() => onGoto("activity")}>View all</button>
			</div>
			{events && events.length === 0 ? (
				<p className="dash-muted">No calls yet. Try the Search playground.</p>
			) : (
				events && (
					<table className="dash-table" style={{ marginTop: 14 }}>
						<tbody>
							{events.map((e) => (
								<tr key={e.id}>
									<td style={{ width: 80 }}>{new Date(e.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
									<td className="dash-mono" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 380 }}>
										{e.endpoint}
									</td>
									<td><StatusPill status={e.statusCode} /></td>
									<td style={{ width: 70, textAlign: "right" }}>{e.latencyMs}ms</td>
								</tr>
							))}
						</tbody>
					</table>
				)
			)}
		</div>
	);
}

function EndpointCard({ title, tag, body, onClick }: { title: string; tag: "API" | "FREE"; body: string; onClick: () => void }) {
	return (
		<button type="button" className="dash-endpoint" onClick={onClick}>
			<div className="dash-endpoint-head">
				<span className="dash-endpoint-tag" data-tag={tag}>{tag}</span>
				<h3>{title}</h3>
			</div>
			<p>{body}</p>
		</button>
	);
}

/**
 * Cookie-auth GET that returns status + parsed body without throwing on
 * non-OK. Used by Activity replay (where 4xx/5xx are valid outcomes worth
 * showing) — playground panels go through `playground/api.ts` instead.
 */
async function rawApiGet(path: string): Promise<{ status: number; body: unknown }> {
	const res = await fetch(`${apiBase}${path}`, { credentials: "include" });
	const text = await res.text();
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		parsed = text;
	}
	return { status: res.status, body: parsed };
}

/* ─────────── Playground shell ─────────── */

const PG_TAB_ICONS = {
	discover: (
		<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<circle cx="11" cy="11" r="7" />
			<path d="m20 20-3.5-3.5" />
		</svg>
	),
	evaluate: (
		<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<circle cx="12" cy="12" r="9" />
			<path d="M12 7v5l3 2" />
		</svg>
	),
};

const PG_TABS: ReadonlyArray<ComposeTab<"discover" | "evaluate">> = [
	{ id: "discover", label: "Discover", icon: PG_TAB_ICONS.discover },
	{ id: "evaluate", label: "Evaluate", icon: PG_TAB_ICONS.evaluate },
];

/**
 * Frames Discover + Evaluate. Each panel renders its own ComposeCard +
 * Tabs (so it can position QuickStarts/RecentRuns below the card on
 * its own). PlaygroundShell mounts both and toggles visibility — form
 * state and trace history survive across tab switches.
 */
function PlaygroundShell({
	active,
	onChange,
	evaluateSeed,
	onEvaluate,
}: {
	active: "discover" | "evaluate";
	onChange: (next: "discover" | "evaluate") => void;
	evaluateSeed: string | null;
	onEvaluate: (itemId: string) => void;
}) {
	const tabsProps = { tabs: PG_TABS, active, onChange } as const;
	return (
		<>
			<div className={active === "discover" ? "" : "hidden"}>
				<PlaygroundDiscover tabsProps={tabsProps} onEvaluate={onEvaluate} />
			</div>
			<div className={active === "evaluate" ? "" : "hidden"}>
				<PlaygroundEvaluate tabsProps={tabsProps} seed={evaluateSeed} />
			</div>
		</>
	);
}

/* ─────────── Keys ─────────── */

function KeysPanel({ keys, issued, setIssued, refresh, onError }: {
	keys: KeyRow[];
	issued: IssuedKey | null;
	setIssued: (k: IssuedKey | null) => void;
	refresh: () => Promise<void>;
	onError: (s: string | null) => void;
}) {
	const [name, setName] = useState("");
	const [pending, setPending] = useState(false);

	async function create(e: React.FormEvent) {
		e.preventDefault();
		setPending(true);
		onError(null);
		try {
			const res = await apiFetch<IssuedKey>("/v1/me/keys", {
				method: "POST",
				body: JSON.stringify({ name: name.trim() || undefined }),
			});
			setIssued(res);
			setName("");
			await refresh();
		} catch (err) {
			onError(err instanceof Error ? err.message : String(err));
		} finally {
			setPending(false);
		}
	}
	async function revoke(id: string) {
		if (!confirm("Revoke this key? Any agents using it will start failing immediately.")) return;
		try {
			await apiFetch(`/v1/me/keys/${id}`, { method: "DELETE" });
			await refresh();
		} catch (err) {
			onError(err instanceof Error ? err.message : String(err));
		}
	}

	return (
		<>
			<section className="dash-page-head">
				<h1>API keys</h1>
				<p>Bearer tokens scoped to your account. Plaintext is shown once at creation.</p>
			</section>
			<div className="dash-card">
				<form className="dash-form-row" onSubmit={create}>
					<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. prod, ci, dev)" maxLength={80} />
					<button type="submit" className="dash-btn dash-btn--brand" disabled={pending}>{pending ? "Creating…" : "New key"}</button>
				</form>
				{issued && (
					<div className="dash-issued">
						<div className="dash-issued-head">
							<span>Save this now — it won't be shown again.</span>
							<button type="button" className="dash-btn dash-btn--sm" onClick={() => navigator.clipboard.writeText(issued.plaintext)}>Copy</button>
						</div>
						<code className="dash-issued-key">{issued.plaintext}</code>
						<button type="button" className="dash-issued-dismiss" onClick={() => setIssued(null)}>Dismiss</button>
					</div>
				)}
				<ul className="dash-keys">
					{keys.length === 0 && <li className="dash-keys-empty">No keys yet. Create one above.</li>}
					{keys.map((k) => (
						<li key={k.id} className="dash-key">
							<div>
								<div className="dash-key-name">{k.name ?? "(unnamed)"}</div>
								<div className="dash-key-meta">
									<code>{k.prefix}…</code>
									<span>· created {new Date(k.createdAt).toLocaleDateString()}</span>
									<span>· last used {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : "never"}</span>
								</div>
							</div>
							<button type="button" className="dash-btn dash-btn--sm" onClick={() => revoke(k.id)}>Revoke</button>
						</li>
					))}
				</ul>
			</div>
		</>
	);
}

/* ─────────── Usage ─────────── */

type BreakdownRow = {
	endpoint: string;
	count: number;
	avgLatencyMs: number;
	p95LatencyMs: number;
	errorCount: number;
};

function UsagePanel({ profile }: { profile: Profile }) {
	const used = profile.usage.used;
	const limit = profile.usage.limit;
	const pct = limit && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
	const [breakdown, setBreakdown] = useState<BreakdownRow[] | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		(async () => {
			try {
				const res = await apiFetch<{ breakdown: BreakdownRow[] }>("/v1/me/usage/breakdown");
				setBreakdown(res.breakdown);
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
			}
		})();
	}, []);

	const maxCount = breakdown && breakdown.length > 0 ? Math.max(...breakdown.map((r) => r.count)) : 1;

	return (
		<>
			<section className="dash-page-head">
				<h1>Usage</h1>
				<p>Resets {new Date(profile.usage.resetAt).toLocaleDateString()} (UTC).</p>
			</section>

			<div className="dash-card">
				<div className="dash-card-eyebrow">This month</div>
				<div className="dash-card-h2">
					{used.toLocaleString()} <span className="dash-of">/ {limit ? limit.toLocaleString() : "∞"} calls</span>
				</div>
				{limit && (
					<div className="dash-bar"><div className="dash-bar-fill" style={{ width: `${pct}%` }} /></div>
				)}
			</div>

			<div className="dash-card">
				<div className="dash-card-eyebrow">By endpoint</div>
				<div className="dash-card-h2">
					{breakdown ? `${breakdown.length} unique paths` : "Loading…"}
				</div>
				{error && <p className="dash-muted">Couldn't load: {error}</p>}
				{breakdown && breakdown.length === 0 && (
					<p className="dash-muted">No metered calls yet this month. Try the Search playground.</p>
				)}
				{breakdown && breakdown.length > 0 && (
					<ul className="dash-bars">
						{breakdown.map((row) => {
							const widthPct = Math.max(4, Math.round((row.count / maxCount) * 100));
							const errPct = row.count > 0 ? Math.round((row.errorCount / row.count) * 100) : 0;
							return (
								<li key={row.endpoint} className="dash-bars-row">
									<div className="dash-bars-head">
										<code className="dash-bars-endpoint">{row.endpoint}</code>
										<span className="dash-bars-count">{row.count.toLocaleString()}</span>
									</div>
									<div className="dash-bars-track">
										<div className="dash-bars-fill" style={{ width: `${widthPct}%` }} />
										{errPct > 0 && (
											<div
												className="dash-bars-fill dash-bars-fill--err"
												style={{ width: `${Math.round(widthPct * (errPct / 100))}%` }}
												title={`${row.errorCount} errors (${errPct}%)`}
											/>
										)}
									</div>
									<div className="dash-bars-meta">
										<span>avg {row.avgLatencyMs}ms</span>
										<span>·</span>
										<span>p95 {row.p95LatencyMs}ms</span>
										{row.errorCount > 0 && (
											<>
												<span>·</span>
												<span className="dash-bars-err">{row.errorCount} err</span>
											</>
										)}
									</div>
								</li>
							);
						})}
					</ul>
				)}
			</div>
		</>
	);
}

/* ─────────── Activity ─────────── */

type EventRow = {
	id: string;
	keyName: string | null;
	keyPrefix: string | null;
	endpoint: string;
	statusCode: number;
	latencyMs: number;
	createdAt: string;
};

type ReplayState = { pending: boolean; result?: { status: number; body: unknown } };

function ActivityPanel() {
	const [events, setEvents] = useState<EventRow[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [replays, setReplays] = useState<Record<string, ReplayState>>({});
	const [expanded, setExpanded] = useState<Set<string>>(new Set());

	useEffect(() => {
		(async () => {
			try {
				const res = await apiFetch<{ events: EventRow[] }>("/v1/me/usage/recent");
				setEvents(res.events);
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
			}
		})();
	}, []);

	async function replay(id: string, endpoint: string) {
		setReplays((prev) => ({ ...prev, [id]: { pending: true } }));
		setExpanded((prev) => new Set(prev).add(id));
		try {
			const res = await rawApiGet(endpoint);
			setReplays((prev) => ({ ...prev, [id]: { pending: false, result: res } }));
		} catch (err) {
			setReplays((prev) => ({
				...prev,
				[id]: { pending: false, result: { status: 0, body: { error: String(err) } } },
			}));
		}
	}

	function toggle(id: string) {
		setExpanded((prev) => {
			const n = new Set(prev);
			if (n.has(id)) n.delete(id);
			else n.add(id);
			return n;
		});
	}

	return (
		<>
			<section className="dash-page-head">
				<h1>Activity</h1>
				<p>Last 50 metered API calls across your keys. GET endpoints can be replayed inline.</p>
			</section>
			<div className="dash-card">
				{error && <p className="dash-muted">Couldn't load: {error}</p>}
				{!error && !events && <p className="dash-muted">Loading…</p>}
				{events && events.length === 0 && <p className="dash-muted">No calls yet. Try the Search playground above.</p>}
				{events && events.length > 0 && (
					<table className="dash-table dash-table--activity">
						<thead>
							<tr>
								<th>When</th>
								<th>Key</th>
								<th>Endpoint</th>
								<th>Status</th>
								<th>Latency</th>
								<th />
							</tr>
						</thead>
						<tbody>
							{events.map((e) => {
								const isExpanded = expanded.has(e.id);
								const replayState = replays[e.id];
								const replayable = e.endpoint.startsWith("/v1/listings") || e.endpoint.startsWith("/v1/sold") || e.endpoint.startsWith("/v1/markets/taxonomy");
								return (
									<Fragment key={e.id}>
										<tr>
											<td>{new Date(e.createdAt).toLocaleTimeString()}</td>
											<td><code>{e.keyName ?? e.keyPrefix ?? "—"}</code></td>
											<td className="dash-mono dash-table-endpoint">{e.endpoint}</td>
											<td><StatusPill status={e.statusCode} /></td>
											<td>{e.latencyMs}ms</td>
											<td className="dash-table-actions">
												{replayable && (
													<button
														type="button"
														className="dash-btn dash-btn--sm"
														onClick={() => replay(e.id, e.endpoint)}
														disabled={replayState?.pending}
														title="Re-run this GET request"
													>
														{replayState?.pending ? "…" : "Replay"}
													</button>
												)}
												{replayState?.result && (
													<button type="button" className="dash-btn dash-btn--sm" onClick={() => toggle(e.id)}>
														{isExpanded ? "Hide" : "Show"}
													</button>
												)}
											</td>
										</tr>
										{isExpanded && replayState?.result && (
											<tr className="dash-table-output">
												<td colSpan={6}>
													<div className="dash-replay-out">
														<div className="dash-replay-head">
															<StatusPill status={replayState.result.status} />
															<span className="dash-mono dash-muted" style={{ margin: 0 }}>{e.endpoint}</span>
														</div>
														<pre className="dash-snippet dash-snippet--scroll">
															<code>{JSON.stringify(replayState.result.body, null, 2)}</code>
														</pre>
													</div>
												</td>
											</tr>
										)}
									</Fragment>
								);
							})}
						</tbody>
					</table>
				)}
			</div>
		</>
	);
}

function StatusPill({ status }: { status: number }) {
	const kind = status < 300 ? "ok" : status < 500 ? "warn" : "err";
	return <span className={`dash-status dash-status--${kind}`}>{status}</span>;
}

/* ─────────── eBay ─────────── */

function EbayPanel({ ebay, keys, features, permissions, refresh, onToast }: {
	ebay: EbayStatus | null;
	keys: KeyRow[];
	features: Features;
	permissions: Permissions | null;
	refresh: () => Promise<void>;
	onToast: (t: Toast) => void;
}) {
	const [busy, setBusy] = useState(false);

	function connect() {
		window.location.href = `${apiBase}/v1/me/ebay/connect?redirect=${encodeURIComponent(window.location.origin + "/dashboard/")}`;
	}
	async function disconnect() {
		if (!confirm("Disconnect eBay? Tokens removed locally; eBay-side authorization stays (revoke at eBay if needed).")) return;
		setBusy(true);
		try {
			await apiFetch("/v1/me/ebay/connect", { method: "DELETE" });
			await refresh();
			onToast({ kind: "success", message: "Disconnected." });
		} catch (err) {
			onToast({ kind: "error", message: err instanceof Error ? err.message : String(err) });
		} finally {
			setBusy(false);
		}
	}

	// Self-host case: this api instance has no eBay developer keyset wired,
	// so the connect button would 503. Show a configuration hint instead.
	if (!features.ebayOAuth) {
		return (
			<>
				<section className="dash-page-head">
					<h1>eBay account</h1>
					<p>OAuth passthrough — your sell-side calls go to api.ebay.com under your token.</p>
				</section>
				<div className="dash-card">
					<div className="dash-card-eyebrow">Not configured on this host</div>
					<div className="dash-card-h2">eBay OAuth env unset</div>
					<p className="dash-muted">
						This instance is running without <code>EBAY_CLIENT_ID</code>, <code>EBAY_CLIENT_SECRET</code>, or <code>EBAY_RU_NAME</code>. <code>/v1/listings/*</code> and <code>/v1/sold/*</code> still work via the scraper. Sell-side endpoints (<code>/v1/inventory</code>, <code>/v1/fulfillment</code>, <code>/v1/finance</code>) return <code>503 ebay_not_configured</code>.
					</p>
					<p className="dash-muted">See <a href="/docs/self-host/">self-host docs</a> for the eBay developer flow.</p>
				</div>
			</>
		);
	}

	return (
		<>
			<section className="dash-page-head">
				<h1>eBay account</h1>
				<p>OAuth passthrough — your sell-side calls go to api.ebay.com under your token.</p>
			</section>
			<div className="dash-card">
				<div className="dash-card-eyebrow">Status</div>
				<div className="dash-card-h2">
					{ebay?.connected ? `Connected${ebay.ebayUserName ? ` as @${ebay.ebayUserName}` : ""}` : "Not connected"}
				</div>
				{ebay?.connected ? (
					<>
						<div className="dash-meta">
							<div><span>Connected since</span><span>{new Date(ebay.connectedAt).toLocaleDateString()}</span></div>
							<div><span>Token expires</span><span>{new Date(ebay.accessTokenExpiresAt).toLocaleString()}</span></div>
							<div><span>Scopes</span><span className="dash-mono">{ebay.scopes.map((s) => s.split("/").pop()).join(", ")}</span></div>
						</div>
						<div className="dash-actions" style={{ marginTop: 16 }}>
							<button type="button" className="dash-btn" onClick={disconnect} disabled={busy}>{busy ? "Disconnecting…" : "Disconnect"}</button>
						</div>
					</>
				) : (
					<>
						<p className="dash-muted">Connect once to unlock <code>/v1/inventory/*</code>, <code>/v1/fulfillment/*</code>, <code>/v1/finance/*</code>, and (when approved) <code>/v1/orders/*</code>.</p>
						<div className="dash-actions" style={{ marginTop: 16 }}>
							<button
								type="button"
								className="dash-btn dash-btn--brand"
								onClick={connect}
								disabled={keys.length === 0}
								title={keys.length === 0 ? "Create an API key first" : undefined}
							>
								Connect eBay account
							</button>
						</div>
					</>
				)}
			</div>

			{permissions && <PermissionsCard permissions={permissions} />}
		</>
	);
}

const SCOPE_LABEL: Record<keyof Permissions["scopes"], { title: string; path: string }> = {
	browse: { title: "Browse listings", path: "/v1/listings/*" },
	marketplaceInsights: { title: "Sold history (Marketplace Insights)", path: "/v1/sold/*" },
	inventory: { title: "Inventory", path: "/v1/inventory/*" },
	fulfillment: { title: "Fulfillment", path: "/v1/fulfillment/*" },
	finance: { title: "Finance", path: "/v1/finance/*" },
	orderApi: { title: "Order API (Limited Release)", path: "/v1/orders/*" },
};

const STATUS_COPY: Record<ScopeStatus, { label: string; tone: "ok" | "warn" | "info" | "off"; help: string }> = {
	ok: { label: "Active", tone: "ok", help: "Calls succeed against this user's token." },
	scrape_fallback: {
		label: "Scrape fallback",
		tone: "info",
		help: "REST not approved/wired; flipagent serves this from the scraper instead.",
	},
	needs_oauth: {
		label: "Needs eBay connect",
		tone: "warn",
		help: "Click 'Connect eBay account' above to grant the required scope.",
	},
	approval_pending: {
		label: "eBay approval pending",
		tone: "warn",
		help: "Apply at developer.ebay.com → Order API. Set EBAY_ORDER_API_APPROVED=1 once granted.",
	},
	unavailable: { label: "Not configured", tone: "off", help: "This api instance has no eBay env wired." },
};

function PermissionsCard({ permissions }: { permissions: Permissions }) {
	const order: (keyof Permissions["scopes"])[] = [
		"browse",
		"marketplaceInsights",
		"inventory",
		"fulfillment",
		"finance",
		"orderApi",
	];
	return (
		<div className="dash-card" style={{ marginTop: 16 }}>
			<div className="dash-card-eyebrow">Per-endpoint access</div>
			<div className="dash-card-h2">What you can call right now</div>
			<table className="dash-table" style={{ marginTop: 12 }}>
				<thead>
					<tr>
						<th>Endpoint</th>
						<th>Path</th>
						<th>Status</th>
					</tr>
				</thead>
				<tbody>
					{order.map((k) => {
						const status = permissions.scopes[k];
						const copy = STATUS_COPY[status];
						return (
							<tr key={k}>
								<td>{SCOPE_LABEL[k].title}</td>
								<td className="dash-mono">{SCOPE_LABEL[k].path}</td>
								<td title={copy.help}>
									<span className={`dash-status dash-status--${copy.tone}`}>{copy.label}</span>
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}

/* ─────────── Billing ─────────── */

function BillingPanel({ tier, features, onError }: {
	tier: Tier;
	features: Features;
	onError: (s: string | null) => void;
}) {
	const [busy, setBusy] = useState<string | null>(null);
	async function upgrade(plan: "hobby" | "pro") {
		setBusy(plan);
		onError(null);
		try {
			const res = await apiFetch<{ url: string }>("/v1/billing/checkout", { method: "POST", body: JSON.stringify({ tier: plan }) });
			window.location.href = res.url;
		} catch (err) {
			onError(err instanceof Error ? err.message : String(err));
			setBusy(null);
		}
	}
	async function portal() {
		setBusy("portal");
		try {
			const res = await apiFetch<{ url: string }>("/v1/billing/portal", { method: "POST" });
			window.location.href = res.url;
		} catch (err) {
			onError(err instanceof Error ? err.message : String(err));
			setBusy(null);
		}
	}

	if (!features.stripe) {
		return (
			<>
				<section className="dash-page-head">
					<h1>Billing</h1>
					<p>Tier limits reset monthly (UTC). Stripe handles payment; we only see customer + subscription IDs.</p>
				</section>
				<div className="dash-card">
					<div className="dash-card-eyebrow">Not configured on this host</div>
					<div className="dash-card-h2">Self-host mode — no metering</div>
					<p className="dash-muted">
						Stripe env vars (<code>STRIPE_SECRET_KEY</code>, <code>STRIPE_WEBHOOK_SECRET</code>, <code>STRIPE_PRICE_HOBBY</code>, <code>STRIPE_PRICE_PRO</code>) are unset. <code>/v1/billing/*</code> returns <code>503 billing_not_configured</code>. Tier limits aren't enforced — your eBay quota is the real ceiling.
					</p>
				</div>
			</>
		);
	}

	return (
		<>
			<section className="dash-page-head">
				<h1>Billing</h1>
				<p>Tier limits reset monthly (UTC). Stripe handles payment; we only see customer + subscription IDs.</p>
			</section>
			<div className="dash-card">
				<div className="dash-card-eyebrow">Current plan</div>
				<div className="dash-card-h2">{tier.toUpperCase()}</div>
				<div className="dash-actions" style={{ marginTop: 16 }}>
					{tier === "free" && (
						<>
							<button type="button" className="dash-btn" onClick={() => upgrade("hobby")} disabled={busy !== null}>
								{busy === "hobby" ? "Opening…" : "Upgrade to Hobby"}
							</button>
							<button type="button" className="dash-btn dash-btn--brand" onClick={() => upgrade("pro")} disabled={busy !== null}>
								{busy === "pro" ? "Opening…" : "Upgrade to Pro"}
							</button>
						</>
					)}
					{(tier === "hobby" || tier === "pro") && (
						<button type="button" className="dash-btn" onClick={portal} disabled={busy !== null}>
							{busy === "portal" ? "Opening…" : "Manage billing"}
						</button>
					)}
				</div>
			</div>
		</>
	);
}

/* ─────────── Integrations ─────────── */

/**
 * Helper text for the agent-install panel. The user's actual key is never
 * surfaced here (we don't store plaintext server-side). The placeholder
 * `fa_xxx` becomes a real key only on `flipagent-cli init --mcp`, which
 * reads it from the user's local config.json.
 */
function IntegrationsPanel({ keys, features: _features }: { keys: KeyRow[]; features: Features }) {
	const [copied, setCopied] = useState<string | null>(null);
	const keyHint = keys[0] ? `${keys[0].prefix}…` : "fa_free_xxx";

	useEffect(() => {
		// Mark this onboarding step done as soon as the user opens the page —
		// we have no other way to detect "they've installed Claude Desktop +
		// pasted the key". Localstorage flag drives the checklist hook.
		try {
			localStorage.setItem(INTEGRATIONS_DONE_KEY, "1");
			window.dispatchEvent(new Event("storage"));
		} catch {
			/* no-op */
		}
	}, []);

	async function copy(label: string, text: string) {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(label);
			setTimeout(() => setCopied(null), 1400);
		} catch {
			/* no-op */
		}
	}

	const cliCommand = "npx -y flipagent-cli init --mcp";
	const claudeJson = `{
  "mcpServers": {
    "flipagent": {
      "command": "npx",
      "args": ["-y", "flipagent-mcp"],
      "env": { "FLIPAGENT_API_KEY": "${keyHint}" }
    }
  }
}`;
	const sdkSnippet = `import { createFlipagentClient } from "@flipagent/sdk";

const client = createFlipagentClient({ apiKey: "${keyHint}" });
const r = await client.listings.search({ q: "canon 50mm", limit: 10 });`;

	return (
		<>
			<section className="dash-page-head">
				<h1>Wire up your agent</h1>
				<p>One command for Claude Desktop / Cursor, or paste the JSON. SDK snippet below for direct API use.</p>
			</section>

			<div className="dash-card">
				<div className="dash-card-eyebrow">Recommended</div>
				<div className="dash-card-h2">Auto-detect every supported client</div>
				<p className="dash-muted">
					Reads your stored key from <code>~/.flipagent/config.json</code> and writes the right MCP entry into Claude Desktop, Cursor, Cline, Continue, Zed, and Windsurf — whatever you have installed.
				</p>
				<div className="dash-code" style={{ marginTop: 14 }}>
					<div className="dash-code-head">
						<span>shell</span>
						<button type="button" className="dash-btn dash-btn--sm" onClick={() => copy("cli", cliCommand)}>
							{copied === "cli" ? "Copied" : "Copy"}
						</button>
					</div>
					<pre><code>{cliCommand}</code></pre>
				</div>
				<p className="dash-muted" style={{ marginTop: 10 }}>
					First time? Run <code>flipagent login</code> with your key, then <code>flipagent init --mcp</code>. Restart your client to pick up the new server.
				</p>
			</div>

			<div className="dash-card" style={{ marginTop: 16 }}>
				<div className="dash-card-eyebrow">Manual MCP</div>
				<div className="dash-card-h2">Drop into <code>claude_desktop_config.json</code></div>
				<p className="dash-muted">
					macOS path: <code>~/Library/Application Support/Claude/claude_desktop_config.json</code>. Cursor uses <code>.cursor/mcp.json</code>.
				</p>
				<div className="dash-code" style={{ marginTop: 14 }}>
					<div className="dash-code-head">
						<span>json</span>
						<button type="button" className="dash-btn dash-btn--sm" onClick={() => copy("json", claudeJson)}>
							{copied === "json" ? "Copied" : "Copy"}
						</button>
					</div>
					<pre><code>{claudeJson}</code></pre>
				</div>
			</div>

			<div className="dash-card" style={{ marginTop: 16 }}>
				<div className="dash-card-eyebrow">Node / TypeScript</div>
				<div className="dash-card-h2">Use the typed SDK directly</div>
				<p className="dash-muted">
					Same surface as MCP, callable from your code. <code>client.listings</code>, <code>client.sold</code>, <code>client.evaluate</code>, <code>client.discover</code>, <code>client.ship</code>.
				</p>
				<div className="dash-code" style={{ marginTop: 14 }}>
					<div className="dash-code-head">
						<span>node</span>
						<button type="button" className="dash-btn dash-btn--sm" onClick={() => copy("sdk", sdkSnippet)}>
							{copied === "sdk" ? "Copied" : "Copy"}
						</button>
					</div>
					<pre><code>{sdkSnippet}</code></pre>
				</div>
				<p className="dash-muted" style={{ marginTop: 10 }}>
					Install: <code>npm i @flipagent/sdk</code>.
				</p>
			</div>
		</>
	);
}
