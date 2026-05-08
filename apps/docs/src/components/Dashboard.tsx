/**
 * Dashboard shell — sidebar + main content. Single-page React app gated by
 * Better-Auth session. The sidebar drives a `view` state; each panel shares
 * the same `profile`, `keys`, and `ebay` data fetched on mount.
 *
 * Views:
 *   overview  → endpoint cards + API key + agent integrations + recent usage
 *   playground/* → small forms that hit the live `/v1/*` endpoints
 *   keys      → CRUD against /v1/me/keys
 *   usage     → monthly counter + (future) per-endpoint breakdown
 *   ebay      → connect / status / disconnect
 *   billing   → upgrade buttons + Stripe portal
 */

import {
	type CapabilitiesResponse,
	EBAY_CONNECT_DISCLAIMER_VERSION,
	PENDING_CONSENT_KEY,
	type SetupStep,
} from "@flipagent/types";
import * as RxDialog from "@radix-ui/react-dialog";
import * as RxPopover from "@radix-ui/react-popover";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Toaster, toast } from "sonner";
import { CHANGELOG, type ChangelogEntry, type ChangelogTag } from "../data/changelog";
import { apiBase, apiFetch, authClient, signOut } from "../lib/authClient";
import type { ComposeTab } from "./compose/ComposeCard";
import { ConnChip } from "./connections/ConnChip";
import { ConnectionsProvider } from "./connections/ConnectionsContext";
import { BillingHistory } from "./dashboard/BillingHistory";
import { BillingTopUp } from "./dashboard/BillingTopUp";
import { EbayConnectConsentModal } from "./dashboard/EbayConnectConsentModal";
import { TermsConsentModal } from "./dashboard/TermsConsentModal";
import { PlaygroundAgent } from "./playground/PlaygroundAgent";
import { PlaygroundAppraise } from "./playground/PlaygroundAppraise";
import { PlaygroundDeals } from "./playground/PlaygroundDeals";
import { PlaygroundEvaluate } from "./playground/PlaygroundEvaluate";
import { PlaygroundSearch } from "./playground/PlaygroundSearch";
import { PlaygroundSourcing } from "./playground/PlaygroundSourcing";
import "./Dashboard.css";
import "./ui/ui.css";
import "./playground/Playground.css";

type Tier = "free" | "hobby" | "standard" | "growth";

type View =
	| "overview"
	| "playground/search"
	| "playground/sourcing"
	| "playground/appraise"
	| "playground/evaluate"
	| "playground/deals"
	| "playground/agent"
	| "keys"
	| "devices"
	| "settings"
	| "usage"
	| "activity"
	| "whatsnew";

type Profile = {
	id: string;
	email: string;
	name: string;
	image: string | null;
	tier: Tier;
	role: "user" | "admin";
	emailVerified: boolean;
	usage: {
		creditsUsed: number;
		creditsLimit: number;
		creditsRemaining: number;
		bonusCredits?: number;
		// Null for Free (one-time grant); ISO timestamp for paid (monthly refill).
		resetAt: string | null;
		// Tier the api enforces against; differs from `tier` only when the
		// user's subscription has been past_due past the grace window
		// (downgrades the *enforcement view* to free without rewriting
		// `tier`). Drives the "card declined — fix in Stripe" banner.
		effectiveTier?: Tier;
	};
	currentTermsVersion: string;
	termsAcceptedAt: string | null;
	termsAcceptedVersion: string | null;
};

function readPendingConsent(): { version: string; at: number } | null {
	try {
		const raw = localStorage.getItem(PENDING_CONSENT_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed.version === "string" && typeof parsed.at === "number") return parsed;
		return null;
	} catch {
		return null;
	}
}

function clearPendingConsent() {
	try {
		localStorage.removeItem(PENDING_CONSENT_KEY);
	} catch {
		/* no-op */
	}
}
type KeyRow = {
	id: string;
	name: string | null;
	prefix: string;
	suffix: string | null;
	tier: Tier;
	createdAt: string;
	lastUsedAt: string | null;
};
type IssuedKey = { id: string; tier: Tier; prefix: string; suffix: string; plaintext: string; notice: string };
/** Mechanism-based connect-status shape: server-side OAuth and the
 *  browser-side bridge are two distinct access paths to (usually) the same
 *  eBay account. */
type EbayStatus = {
	oauth: {
		connected: boolean;
		ebayUserId: string | null;
		ebayUserName: string | null;
		scopes: string[];
		accessTokenExpiresAt: string | null;
		connectedAt: string | null;
	};
	bridge: {
		paired: boolean;
		deviceName: string | null;
		lastSeenAt: string | null;
		ebayLoggedIn: boolean;
		ebayUserName: string | null;
		verifiedAt: string | null;
	};
};
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
	biddingApi: boolean;
	scraperApi: boolean;
	betterAuth: boolean;
	googleOAuth: boolean;
	email: boolean;
	stripe: boolean;
	llm: boolean;
};
const DEFAULT_FEATURES: Features = {
	ebayOAuth: true,
	orderApi: false,
	insightsApi: false,
	biddingApi: false,
	scraperApi: true,
	betterAuth: true,
	googleOAuth: true,
	email: true,
	stripe: true,
	llm: true,
};

type ScopeStatus = "ok" | "scrape" | "needs_oauth" | "approval_pending" | "unavailable";
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
		order: ScopeStatus;
		bidding: ScopeStatus;
	};
};

export default function Dashboard() {
	const [view, setView] = useState<View>("overview");
	const [profile, setProfile] = useState<Profile | null>(null);
	const [keys, setKeys] = useState<KeyRow[]>([]);
	const [ebay, setEbay] = useState<EbayStatus | null>(null);
	const [capabilities, setCapabilities] = useState<CapabilitiesResponse | null>(null);
	const [permissions, setPermissions] = useState<Permissions | null>(null);
	// Cross-link from Search → Evaluate: a row click passes its itemId
	// here, we navigate to evaluate; the panel reads it as its initial
	// input and auto-runs.
	const [evaluateSeed, setEvaluateSeed] = useState<string | null>(null);
	// Deep-link from the landing hero: `/dashboard/?view=agent&seed=<prompt>`
	// drops the visitor on the agent view with `seed` queued as the first
	// turn. Cleared after `PlaygroundAgent` consumes it (the consumed value
	// remains a valid React prop — the ref guard inside the component
	// makes auto-send strictly mount-once).
	const [agentSeed, setAgentSeed] = useState<string | null>(null);
	const [features, setFeatures] = useState<Features>(DEFAULT_FEATURES);
	const [issued, setIssued] = useState<IssuedKey | null>(null);
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
			setEbay({
				oauth: {
					connected: false,
					ebayUserId: null,
					ebayUserName: null,
					scopes: [],
					accessTokenExpiresAt: null,
					connectedAt: null,
				},
				bridge: {
					paired: false,
					deviceName: null,
					lastSeenAt: null,
					ebayLoggedIn: false,
					ebayUserName: null,
					verifiedAt: null,
				},
			});
		}
	}
	async function refreshCapabilities() {
		try {
			const c = await apiFetch<CapabilitiesResponse>("/v1/capabilities");
			setCapabilities(c);
		} catch {
			/* leave stale — checklist is informational, never blocks UI */
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
				// Replay pending clickwrap from social-OAuth or email-verify
				// round-trip if the user hasn't already been recorded as
				// accepting the current Terms version.
				if (me.termsAcceptedVersion !== me.currentTermsVersion) {
					const pending = readPendingConsent();
					if (pending && pending.version === me.currentTermsVersion) {
						try {
							await apiFetch("/v1/me/terms-acceptance", {
								method: "POST",
								body: JSON.stringify({ version: me.currentTermsVersion }),
								headers: { "Content-Type": "application/json" },
							});
							clearPendingConsent();
							const refreshed = await apiFetch<Profile>("/v1/me");
							setProfile(refreshed);
						} catch {
							/* fall through to the modal — user must click again */
						}
					}
				}
				await Promise.all([refreshKeys(), refreshEbay(), refreshPermissions(), refreshCapabilities()]);
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
		const connectParam = p.get("connect");
		if (ebayParam === "connected") {
			const u = p.get("user");
			toast.success(u ? `Connected as @${u}.` : "eBay account connected.");
			window.history.replaceState({}, "", window.location.pathname);
		} else if (ebayParam === "error") {
			toast.error(p.get("message") ?? "eBay connection failed.");
			window.history.replaceState({}, "", window.location.pathname);
		} else if (verified === "1" || verified === "true") {
			toast.success("Email verified.");
			window.history.replaceState({}, "", window.location.pathname);
		}
		// Deep-link from the extension popup: navigate to settings + signal
		// SettingsPanel to auto-open the eBay-connect consent modal on mount.
		// (The modal state lives in SettingsPanel, so we hand off via
		// sessionStorage rather than lifting state up.)
		if (connectParam === "ebay") {
			setView("settings");
			sessionStorage.setItem("flipagent_open_ebay_connect", "1");
			window.history.replaceState({}, "", window.location.pathname);
		}

		// `/dashboard/?view=agent&seed=<prompt>` — landing hero deep-link.
		// Switch the dashboard view, queue the prompt for the agent panel,
		// then strip both params so a refresh / browser-back doesn't replay
		// the same auto-send. PlaygroundAgent's own ref guard makes the
		// fire strictly mount-once even if the prop lingers in state.
		const viewParam = p.get("view");
		const seedParam = p.get("seed");
		if (viewParam === "agent" && seedParam) {
			setAgentSeed(seedParam);
			setView("playground/agent");
			window.history.replaceState({}, "", window.location.pathname);
		}
	}, []);

	// Cross-component nav: any descendant can dispatch `flipagent-goto`
	// to switch the dashboard view without a full reload. Used by the
	// agent hero's connections chip to drop the user on Settings + open
	// the eBay-connect consent modal in one step.
	useEffect(() => {
		function onGoto(e: Event) {
			const detail = (e as CustomEvent<{ to?: View; flag?: string }>).detail;
			if (!detail) return;
			if (detail.flag) sessionStorage.setItem(detail.flag, "1");
			if (detail.to) setView(detail.to);
		}
		window.addEventListener("flipagent-goto", onGoto);
		return () => window.removeEventListener("flipagent-goto", onGoto);
	}, []);

	// Mobile drawer state. Above 720px the sidebar is permanent and
	// this is ignored; at mobile widths the sidebar slides in as an
	// overlay triggered by the hamburger in MobileTopBar. Wrapping
	// setView so any nav click auto-closes the drawer is the table-
	// stakes mobile UX. MUST be declared before any early return —
	// React enforces a stable hook count per render.
	const [mobileNavOpen, setMobileNavOpen] = useState(false);
	const setViewAndCloseDrawer = useCallback(
		(v: View) => {
			setView(v);
			setMobileNavOpen(false);
		},
		[setView],
	);
	const upgradeAction = useCallback(() => {
		setView("settings");
		setMobileNavOpen(false);
		requestAnimationFrame(() => {
			document.getElementById("settings-billing")?.scrollIntoView({ behavior: "smooth", block: "center" });
		});
	}, [setView]);

	if (error && !profile) {
		return <div className="dash-fatal"><p>{error}</p></div>;
	}
	if (!profile) {
		return <div className="dash-loading"><p>Loading…</p></div>;
	}

	const needsConsent = profile.termsAcceptedVersion !== profile.currentTermsVersion;

	return (
		<ConnectionsProvider>
		<div className={`dash-app ${collapsed ? "dash-app--collapsed" : ""} ${mobileNavOpen ? "dash-app--drawer-open" : ""}`}>
			{needsConsent && (
				<TermsConsentModal
					version={profile.currentTermsVersion}
					accepted={profile.termsAcceptedVersion}
					onAccepted={async () => {
						const refreshed = await apiFetch<Profile>("/v1/me");
						setProfile(refreshed);
					}}
				/>
			)}
			<MobileTopBar
				tier={profile.tier}
				open={mobileNavOpen}
				onToggle={() => setMobileNavOpen((v) => !v)}
				onUpgrade={upgradeAction}
			/>
			{mobileNavOpen && (
				<button
					type="button"
					className="dash-drawer-backdrop"
					aria-label="Close menu"
					onClick={() => setMobileNavOpen(false)}
				/>
			)}
			<Sidebar
				view={view}
				setView={setViewAndCloseDrawer}
				profile={profile}
				collapsed={collapsed}
				onToggle={() => setCollapsed((v) => !v)}
				mobileOpen={mobileNavOpen}
			/>
			{!profile.emailVerified && (
				<EmailVerifyBanner email={profile.email} />
			)}
			<main className="dash-main">
				<TopBar tier={profile.tier} onUpgrade={upgradeAction} />
				<div className="dash-content">
					{view === "overview" && (
						<Overview
							profile={profile}
							keys={keys}
							ebay={ebay}
							capabilities={capabilities}
							onGoto={setView}
							refreshProfile={refreshProfile}
							refreshCapabilities={refreshCapabilities}
						/>
					)}
					{(view === "playground/search" ||
						view === "playground/sourcing" ||
						view === "playground/appraise" ||
						view === "playground/evaluate" ||
						view === "playground/deals" ||
						view === "playground/agent") && (
						<PlaygroundShell
							active={
								view === "playground/search"
									? "search"
									: view === "playground/sourcing"
										? "sourcing"
										: view === "playground/appraise"
											? "appraise"
											: view === "playground/evaluate"
												? "evaluate"
												: view === "playground/deals"
													? "deals"
													: "agent"
							}
							onChange={(next) =>
								setView(
									next === "search"
										? "playground/search"
										: next === "sourcing"
											? "playground/sourcing"
											: next === "appraise"
												? "playground/appraise"
												: next === "evaluate"
													? "playground/evaluate"
													: next === "deals"
														? "playground/deals"
														: "playground/agent",
								)
							}
							evaluateSeed={evaluateSeed}
							onEvaluate={(itemId) => {
								setEvaluateSeed(itemId);
								setView("playground/evaluate");
							}}
							agentSeed={agentSeed}
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
					{view === "devices" && <DevicesPanel onError={setError} />}
					{view === "settings" && (
						<SettingsPanel
							profile={profile}
							ebay={ebay}
							keys={keys}
							features={features}
							onError={setError}
							refreshEbay={async () => {
								await Promise.all([refreshEbay(), refreshPermissions()]);
							}}
							refreshProfile={refreshProfile}
							onGoto={setView}
						/>
					)}
					{view === "usage" && <UsagePanel profile={profile} />}
					{view === "activity" && <ActivityPanel />}
					{view === "whatsnew" && <WhatsNewPanel />}
				</div>
			</main>

			<Toaster position="top-right" richColors closeButton />
		</div>
		</ConnectionsProvider>
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

const VERIFY_DISMISS_KEY = "flipagent.verifyBannerDismissedAt";
const VERIFY_REMIND_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

function EmailVerifyBanner({ email }: { email: string }) {
	const [pending, setPending] = useState(false);
	const [hidden, setHidden] = useState<boolean | null>(null);

	useEffect(() => {
		// Snooze for 7 days when dismissed. After that the banner re-surfaces
		// — verifying email matters for password reset + abuse pathways and
		// shouldn't be silently dismissable forever.
		try {
			const raw = localStorage.getItem(VERIFY_DISMISS_KEY);
			const at = raw ? Number.parseInt(raw, 10) : 0;
			const stillSnoozed = at > 0 && Date.now() - at < VERIFY_REMIND_AFTER_MS;
			setHidden(stillSnoozed);
		} catch {
			setHidden(false);
		}
	}, []);

	function dismiss() {
		try {
			localStorage.setItem(VERIFY_DISMISS_KEY, String(Date.now()));
		} catch {
			/* no-op */
		}
		setHidden(true);
	}

	async function resend() {
		setPending(true);
		try {
			await authClient.sendVerificationEmail({
				email,
				callbackURL: `${window.location.origin}/dashboard/?verified=1`,
			});
			toast.success(`Verification link re-sent to ${email}.`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : String(err));
		} finally {
			setPending(false);
		}
	}

	if (hidden !== false) return null;

	return (
		<div className="dash-verify-banner">
			<div className="dash-verify-text">
				<strong>Verify your email.</strong> We sent a link to <code>{email}</code>. Confirm to keep your account active.
			</div>
			<div className="dash-actions">
				<button type="button" className="dash-btn dash-btn--sm" onClick={resend} disabled={pending}>
					{pending ? "Sending…" : "Resend"}
				</button>
				<button type="button" className="dash-btn dash-btn--sm" onClick={dismiss} aria-label="Dismiss for 7 days">×</button>
			</div>
		</div>
	);
}

/* ─────────── Sidebar ─────────── */

interface SidebarAgentThread {
	id: string;
	title?: string;
	pinnedAt?: string;
	lastActiveAt: string;
}

function Sidebar({
	view,
	setView,
	profile,
	collapsed,
	onToggle,
	mobileOpen,
}: {
	view: View;
	setView: (v: View) => void;
	profile: Profile;
	collapsed: boolean;
	onToggle: () => void;
	/** Drawer-open flag from the mobile top bar. Ignored above 720px
	 * (the sidebar is permanent there); below 720px controls the
	 * `dash-sidebar--mobile-open` class that slides the drawer in. */
	mobileOpen: boolean;
}) {
	const [query, setQuery] = useState("");
	const q = query.trim().toLowerCase();
	const matches = (label: string) => !q || label.toLowerCase().includes(q);

	// Agent thread list — fetched once + refreshed on focus and on the
	// custom `flipagent-sessions-changed` event the agent surface fires
	// after creating a new thread. Sub-nav under the Agent NavItem.
	const [agentExpanded, setAgentExpanded] = useState(view === "playground/agent");
	const [agentThreads, setAgentThreads] = useState<SidebarAgentThread[]>([]);
	const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
	useEffect(() => {
		if (view === "playground/agent") setAgentExpanded(true);
	}, [view]);
	useEffect(() => {
		const ac = new AbortController();
		async function pull() {
			try {
				const res = await fetch(`${apiBase}/v1/agent/sessions`, {
					credentials: "include",
					signal: ac.signal,
				});
				if (!res.ok) return;
				const body = (await res.json().catch(() => null)) as
					| { sessions?: SidebarAgentThread[] }
					| null;
				setAgentThreads(body?.sessions ?? []);
			} catch {
				/* swallow — sidebar is best-effort */
			}
		}
		pull();
		const onFocus = () => pull();
		const onChanged = () => pull();
		const onActivate = (e: Event) => {
			const detail = (e as CustomEvent<{ sessionId: string | null }>).detail;
			setActiveThreadId(detail?.sessionId ?? null);
		};
		window.addEventListener("focus", onFocus);
		window.addEventListener("flipagent-sessions-changed", onChanged);
		window.addEventListener("flipagent-active-thread", onActivate);
		return () => {
			ac.abort();
			window.removeEventListener("focus", onFocus);
			window.removeEventListener("flipagent-sessions-changed", onChanged);
			window.removeEventListener("flipagent-active-thread", onActivate);
		};
	}, []);

	function jumpToThread(sessionId: string | null) {
		setActiveThreadId(sessionId);
		setView("playground/agent");
		window.dispatchEvent(
			new CustomEvent("flipagent-load-thread", { detail: { sessionId } }),
		);
	}

	const [openMenuId, setOpenMenuId] = useState<string | null>(null);
	const [renameTarget, setRenameTarget] = useState<{ id: string; current: string } | null>(null);
	const [renameValue, setRenameValue] = useState("");
	const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
	const [dialogPending, setDialogPending] = useState(false);
	useEffect(() => {
		if (!openMenuId) return;
		function close() {
			setOpenMenuId(null);
		}
		window.addEventListener("click", close);
		window.addEventListener("keydown", (e) => {
			if (e.key === "Escape") close();
		});
		return () => window.removeEventListener("click", close);
	}, [openMenuId]);

	async function patchThread(id: string, body: { title?: string; pinned?: boolean }) {
		try {
			const res = await fetch(`${apiBase}/v1/agent/sessions/${encodeURIComponent(id)}`, {
				method: "PATCH",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			if (!res.ok) return;
			const updated = (await res.json()) as SidebarAgentThread;
			setAgentThreads((prev) => {
				const next = prev.map((t) => (t.id === id ? { ...t, ...updated } : t));
				// Re-sort: pinned (most-recent first) over the rest.
				next.sort((a, b) => {
					if (!!a.pinnedAt !== !!b.pinnedAt) return a.pinnedAt ? -1 : 1;
					if (a.pinnedAt && b.pinnedAt) return b.pinnedAt.localeCompare(a.pinnedAt);
					return b.lastActiveAt.localeCompare(a.lastActiveAt);
				});
				return next;
			});
			window.dispatchEvent(new CustomEvent("flipagent-sessions-changed"));
		} catch {
			/* swallow */
		}
	}

	async function performDelete(id: string) {
		try {
			const res = await fetch(`${apiBase}/v1/agent/sessions/${encodeURIComponent(id)}`, {
				method: "DELETE",
				credentials: "include",
			});
			if (!res.ok && res.status !== 404) return;
			setAgentThreads((prev) => prev.filter((t) => t.id !== id));
			if (activeThreadId === id) {
				setActiveThreadId(null);
				window.dispatchEvent(
					new CustomEvent("flipagent-load-thread", { detail: { sessionId: null } }),
				);
			}
			window.dispatchEvent(new CustomEvent("flipagent-sessions-changed"));
		} catch {
			/* swallow */
		}
	}

	function openRenameDialog(id: string, current: string) {
		setRenameTarget({ id, current });
		setRenameValue(current);
	}

	function openDeleteDialog(id: string, title: string) {
		setDeleteTarget({ id, title });
	}

	const overviewMatch = matches("Overview");
	const isAdmin = profile.role === "admin";
	const pgItems: { v: View; icon: keyof typeof ICONS; label: string; pill?: string }[] = [
		{ v: "playground/search", icon: "search", label: "Search" },
		{ v: "playground/sourcing", icon: "tree", label: "Sourcing" },
		{ v: "playground/appraise", icon: "gauge", label: "Worth" },
		{ v: "playground/evaluate", icon: "gauge", label: "Buy decision" },
		// Admin-only for now — the underlying `/v1/admin/evaluations` route
		// is gated by `requireAdmin`, and we hide the entry until the public
		// surface is ready. Drop the `isAdmin` filter to roll it out.
		...(isAdmin
			? [{ v: "playground/deals" as View, icon: "trend" as const, label: "Top deals", pill: "admin" }]
			: []),
		{ v: "playground/agent", icon: "spark", label: "Agent", pill: "preview" },
	];
	type SidebarGroup = { label: string; items: { v: View; icon: keyof typeof ICONS; label: string }[] };
	const groups: SidebarGroup[] = [
		{
			label: "Account",
			items: [
				{ v: "keys", icon: "key", label: "API keys" },
				{ v: "devices", icon: "device", label: "Devices" },
				{ v: "activity", icon: "list", label: "Activity" },
				{ v: "usage", icon: "bar", label: "Usage" },
				{ v: "settings", icon: "cog", label: "Settings" },
			],
		},
	];
	const unread = useUnreadChangelogCount();
	const pgVisible = pgItems.filter((i) => matches(i.label));
	const groupsVisible = groups
		.map((g) => ({ ...g, items: g.items.filter((i) => matches(i.label)) }))
		.filter((g) => g.items.length > 0);
	const anyMatch = overviewMatch || pgVisible.length > 0 || groupsVisible.length > 0;

	return (
		<aside className={`dash-sidebar ${mobileOpen ? "dash-sidebar--mobile-open" : ""}`}>
			<a href="/" className="dash-brand">
				<img src="/logo.png" width="60" height="18" alt="" aria-hidden="true" />
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
						{pgVisible.map((i) => {
							if (i.v !== "playground/agent") {
								return (
									<NavItem
										key={i.v}
										icon={i.icon}
										label={i.label}
										active={view === i.v}
										onClick={() => setView(i.v)}
										collapsed={collapsed}
										pill={i.pill}
									/>
								);
							}
							return (
								<Fragment key={i.v}>
									<NavItem
										icon={i.icon}
										label={i.label}
										active={view === i.v}
										onClick={() => setView(i.v)}
										collapsed={collapsed}
										pill={i.pill}
										expandable
										expanded={agentExpanded}
										onToggleExpand={() => setAgentExpanded((v) => !v)}
									/>
									{!collapsed && agentExpanded && (
										<div className="dash-agent-threads">
											<button
												type="button"
												className="dash-agent-thread dash-agent-thread-new"
												onClick={() => jumpToThread(null)}
											>
												<span className="dash-agent-thread-title">+ New thread</span>
											</button>
											{agentThreads.length === 0 ? (
												<span className="dash-agent-thread-empty">No threads yet.</span>
											) : (
												agentThreads.slice(0, 24).map((t) => {
													const title = t.title ?? "Untitled";
													const isActive = activeThreadId === t.id && view === "playground/agent";
													const isMenuOpen = openMenuId === t.id;
													return (
														<div key={t.id} className="dash-agent-thread-row">
															<button
																type="button"
																className={`dash-agent-thread${isActive ? " active" : ""}`}
																onClick={() => jumpToThread(t.id)}
																title={title}
															>
																{t.pinnedAt && (
																	<span className="dash-agent-thread-pin" aria-hidden="true">
																		<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
																			<path d="M14.4 6.6l-3 3-3.3-1.1c-.4-.1-.8 0-1.1.3l-1.4 1.4c-.3.3-.3.8 0 1.1l3.4 3.4-4.6 4.6 1.4 1.4 4.6-4.6 3.4 3.4c.3.3.8.3 1.1 0l1.4-1.4c.3-.3.4-.7.3-1.1L14.6 12l3-3 1.4 1.4 1.4-1.4-7.4-7.4-1.4 1.4 1.4 1.6z" />
																		</svg>
																	</span>
																)}
																<span className="dash-agent-thread-title">{title}</span>
															</button>
															<button
																type="button"
																className={`dash-agent-thread-more${isMenuOpen ? " open" : ""}`}
																aria-haspopup="menu"
																aria-expanded={isMenuOpen}
																aria-label="Thread options"
																onClick={(e) => {
																	e.stopPropagation();
																	setOpenMenuId(isMenuOpen ? null : t.id);
																}}
															>
																<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
																	<circle cx="5" cy="12" r="1.6" />
																	<circle cx="12" cy="12" r="1.6" />
																	<circle cx="19" cy="12" r="1.6" />
																</svg>
															</button>
															{isMenuOpen && (
																<div
																	className="dash-agent-thread-menu"
																	role="menu"
																	onClick={(e) => e.stopPropagation()}
																>
																	<button
																		type="button"
																		role="menuitem"
																		className="dash-agent-thread-menu-item"
																		onClick={() => {
																			setOpenMenuId(null);
																			patchThread(t.id, { pinned: !t.pinnedAt });
																		}}
																	>
																		{t.pinnedAt ? "Unpin" : "Pin"}
																	</button>
																	<button
																		type="button"
																		role="menuitem"
																		className="dash-agent-thread-menu-item"
																		onClick={() => {
																			setOpenMenuId(null);
																			openRenameDialog(t.id, title);
																		}}
																	>
																		Rename
																	</button>
																	<button
																		type="button"
																		role="menuitem"
																		className="dash-agent-thread-menu-item danger"
																		onClick={() => {
																			setOpenMenuId(null);
																			openDeleteDialog(t.id, title);
																		}}
																	>
																		Delete
																	</button>
																</div>
															)}
														</div>
													);
												})
											)}
										</div>
									)}
								</Fragment>
							);
						})}
					</>
				)}

				{groupsVisible.map((g) => (
					<Fragment key={g.label}>
						<NavGroup label={g.label} collapsed={collapsed} />
						{g.items.map((i) => (
							<NavItem key={i.v} icon={i.icon} label={i.label} active={view === i.v} onClick={() => setView(i.v)} collapsed={collapsed} />
						))}
					</Fragment>
				))}

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
				<UserMenu profile={profile} collapsed={collapsed} setView={setView} />
				<button type="button" className="dash-collapse" onClick={onToggle}>
					<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
						{collapsed ? <path d="M6 4l4 4-4 4" /> : <path d="M10 4l-4 4 4 4" />}
					</svg>
					{!collapsed && <span>Collapse</span>}
				</button>
			</div>

			<RxDialog.Root
				open={renameTarget != null}
				onOpenChange={(o) => {
					if (!o) {
						setRenameTarget(null);
						setRenameValue("");
					}
				}}
			>
				<RxDialog.Portal>
					<RxDialog.Overlay className="rx-dialog-overlay" />
					<RxDialog.Content className="rx-dialog-content">
						<RxDialog.Title className="rx-dialog-title">Rename thread</RxDialog.Title>
						<form
							onSubmit={async (e) => {
								e.preventDefault();
								if (!renameTarget) return;
								const trimmed = renameValue.trim();
								if (!trimmed || trimmed === renameTarget.current) {
									setRenameTarget(null);
									return;
								}
								setDialogPending(true);
								await patchThread(renameTarget.id, { title: trimmed });
								setDialogPending(false);
								setRenameTarget(null);
								setRenameValue("");
							}}
						>
							<input
								className="rx-dialog-input"
								autoFocus
								value={renameValue}
								onChange={(e) => setRenameValue(e.target.value)}
								maxLength={200}
								placeholder="Thread name"
							/>
							<div className="rx-dialog-actions">
								<RxDialog.Close asChild>
									<button type="button" className="rx-dialog-btn">
										Cancel
									</button>
								</RxDialog.Close>
								<button
									type="submit"
									className="rx-dialog-btn rx-dialog-btn-primary"
									disabled={dialogPending || !renameValue.trim()}
								>
									{dialogPending ? "Saving…" : "Save"}
								</button>
							</div>
						</form>
					</RxDialog.Content>
				</RxDialog.Portal>
			</RxDialog.Root>

			<RxDialog.Root
				open={deleteTarget != null}
				onOpenChange={(o) => {
					if (!o) setDeleteTarget(null);
				}}
			>
				<RxDialog.Portal>
					<RxDialog.Overlay className="rx-dialog-overlay" />
					<RxDialog.Content className="rx-dialog-content">
						<RxDialog.Title className="rx-dialog-title">Delete thread?</RxDialog.Title>
						<RxDialog.Description className="rx-dialog-desc">
							"{deleteTarget?.title}" and its full chat history will be permanently removed.
							This can't be undone.
						</RxDialog.Description>
						<div className="rx-dialog-actions">
							<RxDialog.Close asChild>
								<button type="button" className="rx-dialog-btn">
									Cancel
								</button>
							</RxDialog.Close>
							<button
								type="button"
								className="rx-dialog-btn rx-dialog-btn-danger"
								disabled={dialogPending}
								onClick={async () => {
									if (!deleteTarget) return;
									setDialogPending(true);
									await performDelete(deleteTarget.id);
									setDialogPending(false);
									setDeleteTarget(null);
								}}
							>
								{dialogPending ? "Deleting…" : "Delete"}
							</button>
						</div>
					</RxDialog.Content>
				</RxDialog.Portal>
			</RxDialog.Root>
		</aside>
	);
}

function UserMenu({
	profile,
	collapsed,
	setView,
}: {
	profile: Profile;
	collapsed: boolean;
	setView: (v: View) => void;
}) {
	const [open, setOpen] = useState(false);
	const initial = profile.email[0]?.toUpperCase() ?? "?";
	const display = profile.name || profile.email;

	const go = (v: View) => {
		setView(v);
		setOpen(false);
	};

	return (
		<RxPopover.Root open={open} onOpenChange={setOpen}>
			<RxPopover.Trigger asChild>
				<button
					type="button"
					className={`dash-user-trigger${open ? " open" : ""}`}
					title={collapsed ? display : undefined}
					aria-label="Account menu"
				>
					{profile.image ? (
						<img src={profile.image} alt="" referrerPolicy="no-referrer" />
					) : (
						<span className="dash-user-avatar">{initial}</span>
					)}
					{!collapsed && <span className="dash-user-trigger-label">{display}</span>}
				</button>
			</RxPopover.Trigger>
			<RxPopover.Portal>
				<RxPopover.Content
					className="dash-user-menu"
					side="top"
					align="start"
					sideOffset={8}
					collisionPadding={12}
				>
					<div className="dash-user-menu-head">
						<span>Account</span>
						<RxPopover.Close className="dash-user-menu-close" aria-label="Close">
							<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
								<path d="M4 4l8 8M12 4l-8 8" />
							</svg>
						</RxPopover.Close>
					</div>

					<div className="dash-user-menu-section">
						<a
							className="dash-user-menu-item"
							href="/docs/"
							target="_blank"
							rel="noreferrer"
							onClick={() => setOpen(false)}
						>
							<span className="dash-user-menu-icon" aria-hidden="true">
								<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
									<path d="M9 2.5H4v11h8V5.5L9 2.5z" />
									<path d="M9 2.5v3h3" />
								</svg>
							</span>
							<span className="dash-user-menu-label">Documentation</span>
							<span className="dash-user-menu-ext" aria-hidden="true">
								<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
									<path d="M6 3h7v7M13 3 6 10M3 6v7h7" />
								</svg>
							</span>
						</a>
						<a
							className="dash-user-menu-item"
							href="https://github.com/flipagent/flipagent"
							target="_blank"
							rel="noreferrer"
							onClick={() => setOpen(false)}
						>
							<span className="dash-user-menu-icon" aria-hidden="true">
								<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
									<path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
								</svg>
							</span>
							<span className="dash-user-menu-label">GitHub</span>
							<span className="dash-user-menu-ext" aria-hidden="true">
								<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
									<path d="M6 3h7v7M13 3 6 10M3 6v7h7" />
								</svg>
							</span>
						</a>
					</div>

					<div className="dash-user-menu-section">
						<button type="button" className="dash-user-menu-item" onClick={() => go("settings")}>
							<span className="dash-user-menu-icon" aria-hidden="true">
								<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
									<circle cx="8" cy="6" r="2.5" />
									<path d="M3 14c0-2.5 2.2-4 5-4s5 1.5 5 4" />
								</svg>
							</span>
							<span className="dash-user-menu-label">Account settings</span>
						</button>
					</div>

					<div className="dash-user-menu-section">
						<button
							type="button"
							className="dash-user-menu-item"
							onClick={() => signOut().finally(() => (window.location.href = "/"))}
						>
							<span className="dash-user-menu-icon" aria-hidden="true">
								<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
									<path d="M9.5 3H3v10h6.5M7 8h7M11 5l3 3-3 3" />
								</svg>
							</span>
							<span className="dash-user-menu-label">Sign out</span>
						</button>
					</div>
				</RxPopover.Content>
			</RxPopover.Portal>
		</RxPopover.Root>
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
	expandable,
	expanded,
	onToggleExpand,
}: {
	icon: keyof typeof ICONS;
	label: string;
	active: boolean;
	onClick: () => void;
	collapsed: boolean;
	pill?: string;
	expandable?: boolean;
	expanded?: boolean;
	onToggleExpand?: () => void;
}) {
	const className = ["dash-nav-item", active ? "active" : "", expandable && expanded ? "dash-nav-agent-open" : ""]
		.filter(Boolean)
		.join(" ");
	return (
		<button type="button" className={className} onClick={onClick} title={collapsed ? label : undefined}>
			<span className="dash-nav-icon" aria-hidden="true">{ICONS[icon]}</span>
			{!collapsed && (
				<>
					<span className="dash-nav-label">{label}</span>
					{pill && <span className="dash-nav-pill">{pill}</span>}
					{expandable && (
						<span
							className={`dash-nav-chev${expanded ? " open" : ""}`}
							role="button"
							tabIndex={0}
							aria-label={expanded ? "Collapse threads" : "Expand threads"}
							aria-expanded={!!expanded}
							onClick={(e) => {
								e.stopPropagation();
								onToggleExpand?.();
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									e.stopPropagation();
									onToggleExpand?.();
								}
							}}
						>
							<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
								<path d="m6 9 6 6 6-6" />
							</svg>
						</span>
					)}
				</>
			)}
		</button>
	);
}

const ICONS = {
	home: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 8l6-5 6 5M3 7v6.5h10V7" /></svg>,
	search: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="7" cy="7" r="4.5" /><path d="m13 13-2.5-2.5" /></svg>,
	doc: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 1.5h7L13 4v10.5H3z" /><path d="M10 1.5V4h3M5.5 8h5M5.5 11h5" /></svg>,
	compass: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="6" /><path d="M8 3l2 5-2 5-2-5z" /></svg>,
	tree: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="3" cy="3" r="1" /><path d="M3 4v9" /><path d="M3 8h5" /><path d="M3 12h5" /><circle cx="10" cy="8" r="1" /><circle cx="10" cy="12" r="1" /></svg>,
	gauge: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11a5 5 0 0 1 10 0" /><path d="M8 11l2.5-2.5" /><circle cx="8" cy="11" r="0.6" fill="currentColor" /></svg>,
	box: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 5l6-3 6 3v6l-6 3-6-3V5z" /><path d="M2 5l6 3 6-3M8 8v6" /></svg>,
	key: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="5" cy="11" r="2.5" /><path d="M7 9l6-6M11 5l1.5 1.5" /></svg>,
	bar: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 13V3M2.5 13h11M5 11V8M8 11V5M11 11V7" /></svg>,
	list: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4h8M5 8h8M5 12h8" /><circle cx="2.5" cy="4" r="0.5" fill="currentColor" /><circle cx="2.5" cy="8" r="0.5" fill="currentColor" /><circle cx="2.5" cy="12" r="0.5" fill="currentColor" /></svg>,
	link: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6.5 9.5a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5L7.5 5" /><path d="M9.5 6.5a2.5 2.5 0 0 0-3.5 0l-2 2a2.5 2.5 0 0 0 3.5 3.5L8.5 11" /></svg>,
	wallet: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M13 4H4a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 4 13h9z" /><path d="M2.5 5.5h11M10 9h1.5" /></svg>,
	device: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="12" height="8.5" rx="1" /><path d="M5.5 14h5M8 11.5V14" /></svg>,
	cog: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="2.5" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>,
	spark: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2.5l1.4 3.6L13 7.5l-3.6 1.4L8 12.5 6.6 8.9 3 7.5l3.6-1.4z" /><path d="M13 2v2M14 3h-2" /></svg>,
	trend: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m2.5 11 4-4 3 3 4-5" /><path d="M9.5 5h4v4" /></svg>,
};

/* ─────────── Top bar ─────────── */

/* Mobile-only header with hamburger + brand + tier pill. The desktop
 * sidebar carries the brand, search, nav, etc.; below 720px we collapse
 * the sidebar into a drawer and surface this slim bar so the brand +
 * tier are always visible and the menu is one tap away. Hidden above
 * 720px via `display: none` in `Dashboard.css`. */
function MobileTopBar({
	tier,
	open,
	onToggle,
	onUpgrade,
}: {
	tier: Tier;
	open: boolean;
	onToggle: () => void;
	onUpgrade: () => void;
}) {
	return (
		<header className="dash-mobile-topbar" data-open={open ? "true" : "false"}>
			<button
				type="button"
				className="dash-mobile-menu"
				aria-label={open ? "Close menu" : "Open menu"}
				aria-expanded={open}
				onClick={onToggle}
			>
				<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
					{open ? (
						<>
							<path d="M5 5l10 10" />
							<path d="M15 5L5 15" />
						</>
					) : (
						<>
							<path d="M3 6h14" />
							<path d="M3 10h14" />
							<path d="M3 14h14" />
						</>
					)}
				</svg>
			</button>
			<a href="/" className="dash-mobile-brand">
				<img src="/logo.png" width="56" height="16" alt="" aria-hidden="true" />
				<span>flipagent</span>
			</a>
			<div className="dash-mobile-actions">
				<span className="dash-tier-pill" data-tier={tier}>{tier.toUpperCase()}</span>
				{tier === "free" && (
					<button type="button" className="dash-mobile-upgrade" onClick={onUpgrade}>
						Upgrade
					</button>
				)}
			</div>
		</header>
	);
}

function TopBar({ tier, onUpgrade }: { tier: Tier; onUpgrade: () => void }) {
	return (
		<header className="dash-topbar">
			<div className="dash-topbar-left">
				<span className="dash-tier-pill" data-tier={tier}>{tier.toUpperCase()}</span>
				<ConnChip />
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

/* ─────────── Setup checklist ─────────── */
/* Mirrors the extension popup's 4-row checklist 1:1. Same step ids,
 * statuses, labels — sourced from `/v1/capabilities.checklist`. The
 * dashboard surface adds richer per-row CTAs (scroll into settings,
 * trigger consent modal in-place) but the underlying state machine is
 * shared. Hidden once every required step is `done` (Optional rows
 * left undone don't keep the card on screen). */

const SETUP_DISMISSED_KEY = "flipagent.setupDismissed";

function useShowSetup(checklist: CapabilitiesResponse["checklist"] | undefined): boolean {
	const [dismissed, setDismissed] = useState(false);
	useEffect(() => {
		const read = () => {
			try {
				setDismissed(localStorage.getItem(SETUP_DISMISSED_KEY) === "1");
			} catch {
				/* no-op */
			}
		};
		read();
		window.addEventListener("storage", read);
		return () => window.removeEventListener("storage", read);
	}, []);
	if (!checklist) return false;
	if (dismissed) return false;
	return !checklist.allRequiredDone;
}

function SetupCard({
	checklist,
	ebayUserName,
	onGoto,
}: {
	checklist: CapabilitiesResponse["checklist"];
	ebayUserName: string | null;
	onGoto: (v: View) => void;
}) {
	function dismiss() {
		try {
			localStorage.setItem(SETUP_DISMISSED_KEY, "1");
		} catch {
			/* no-op */
		}
		window.dispatchEvent(new Event("storage"));
	}

	const doneCount = checklist.steps.filter((s) => s.status === "done").length;
	const totalCount = checklist.steps.length;
	const firstActiveIdx = checklist.steps.findIndex((s) => s.status === "active");

	return (
		<div className="dash-card dash-checklist">
			<div className="dash-checklist-head">
				<div>
					<div className="dash-card-eyebrow">Setup</div>
					<div className="dash-card-h2">
						{doneCount} <span className="dash-of">/ {totalCount} steps complete</span>
					</div>
				</div>
				{checklist.allRequiredDone && (
					<button type="button" className="dash-btn dash-btn--sm" onClick={dismiss}>Hide</button>
				)}
			</div>
			<ol className="dash-checklist-list">
				{checklist.steps.map((step, i) => {
					const done = step.status === "done";
					const locked = step.status === "locked";
					const cta = ctaForStep(step, onGoto);
					const titleOverride = renderTitle(step, ebayUserName);
					return (
						<li key={step.id} className={`dash-checklist-item ${done ? "is-done" : ""}`}>
							<span className={`dash-checklist-check ${done ? "is-done" : ""}`} aria-hidden="true">
								{done ? (
									<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5l3.5 3.5L13 5" /></svg>
								) : (
									i + 1
								)}
							</span>
							<div className="dash-checklist-body">
								<div className="dash-checklist-title">
									<span>{titleOverride}</span>
									{!step.required && !done && <span className="dash-checklist-pill">Optional</span>}
								</div>
								<div className="dash-checklist-text">{step.description}</div>
							</div>
							{!done && cta && (
								<button
									type="button"
									className={`dash-btn ${i === firstActiveIdx ? "dash-btn--brand" : ""}`}
									onClick={cta.onClick}
									disabled={locked}
									title={locked ? "Pair the extension first to detect your eBay session." : undefined}
								>
									{cta.label}
								</button>
							)}
						</li>
					);
				})}
			</ol>
		</div>
	);
}

function renderTitle(step: SetupStep, ebayUserName: string | null): string {
	if (step.id === "ebay_signin" && step.status === "done" && ebayUserName) {
		return `Signed in to eBay · ${ebayUserName}`;
	}
	return step.title;
}

function ctaForStep(step: SetupStep, onGoto: (v: View) => void): { label: string; onClick: () => void } | null {
	switch (step.id) {
		case "pair_extension":
			return {
				label: "Install extension",
				onClick: () => window.open("/docs/extension/", "_blank"),
			};
		case "ebay_signin":
			return {
				label: "Open ebay.com",
				onClick: () => window.open("https://www.ebay.com/", "_blank", "noopener"),
			};
		case "seller_oauth":
			return {
				label: "Connect",
				onClick: () => {
					onGoto("settings");
					sessionStorage.setItem("flipagent_open_ebay_connect", "1");
					requestAnimationFrame(() => {
						document.getElementById("settings-ebay")?.scrollIntoView({ behavior: "smooth", block: "center" });
					});
				},
			};
	}
}

/* ─────────── Overview ─────────── */

function Overview({
	profile,
	keys,
	ebay,
	capabilities,
	onGoto,
	refreshProfile,
	refreshCapabilities,
}: {
	profile: Profile;
	keys: KeyRow[];
	ebay: EbayStatus | null;
	capabilities: CapabilitiesResponse | null;
	onGoto: (v: View) => void;
	refreshProfile: () => Promise<void>;
	refreshCapabilities: () => Promise<void>;
}) {
	const primaryKey = keys[0];

	// Re-pull profile + capabilities when Overview mounts so usage and
	// extension/oauth status reflect any changes since the last load.
	useEffect(() => {
		refreshProfile();
		refreshCapabilities();
	}, []);

	const checklist = capabilities?.checklist;
	const showSetup = useShowSetup(checklist);
	const hasKey = keys.length > 0;
	const showKeyCard = !showSetup || hasKey;

	return (
		<>
			<section className="dash-page-head">
				<h1>Explore your endpoints</h1>
				<p>Try the live API from the browser — search, evaluate, and ship — without leaving the dashboard.</p>
			</section>

			{showSetup && checklist && (
				<SetupCard checklist={checklist} ebayUserName={ebay?.bridge.ebayUserName ?? null} onGoto={onGoto} />
			)}

			<div className="dash-cards">
				<EndpointCard
					title="Sourcing"
					tag="API"
					body="Navigate eBay's category tree live. Scan active listings in any category, narrow with a keyword, jump to a single Evaluate run."
					onClick={() => onGoto("playground/sourcing")}
				/>
				<EndpointCard
					title="Evaluate"
					tag="API"
					body="Drop in any eBay item. Returns a buy/pass call backed by what the same item recently sold for."
					onClick={() => onGoto("playground/evaluate")}
				/>
			</div>

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

			<div className="dash-card" id="quickstart-curl">
				<div className="dash-card-head">
					<div>
						<div className="dash-card-eyebrow">Quick start</div>
						<div className="dash-card-h2">cURL — search canon 50mm</div>
					</div>
					<button
						type="button"
						className="dash-btn dash-btn--sm"
						onClick={() => {
							const cmd = `curl "${apiBase}/v1/items/search?q=canon%2050mm&limit=5" -H "X-API-Key: ${
								primaryKey ? primaryKey.prefix + "…" : "<YOUR_KEY>"
							}"`;
							navigator.clipboard.writeText(cmd).catch(() => undefined);
						}}
					>
						Copy
					</button>
				</div>
				<pre className="dash-snippet">
					<code>{`curl "${apiBase}/v1/items/search?q=canon%2050mm&limit=5" \\
  -H "X-API-Key: ${primaryKey ? primaryKey.prefix + "…" : "<YOUR_KEY>"}"`}</code>
				</pre>
				<p className="dash-muted" style={{ marginTop: 10 }}>
					Or run it from the {" "}
					<button type="button" className="dash-link" onClick={() => onGoto("playground/sourcing")}>
						Sourcing playground
					</button>{" "}
					with a click-through tree and inline Evaluate.
				</p>
			</div>

			<div className="dash-card dash-card--inline-stat">
				<div>
					<div className="dash-card-eyebrow">This month</div>
					<div className="dash-card-h2">
						{profile.usage.creditsUsed.toLocaleString()}
						<span className="dash-of"> / {profile.usage.creditsLimit.toLocaleString()} credits</span>
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
									<td style={{ width: 80, whiteSpace: "nowrap" }}>{new Date(e.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
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
	search: (
		<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<circle cx="10.5" cy="10.5" r="6.5" />
			<path d="m20 20-4.5-4.5" />
		</svg>
	),
	sourcing: (
		<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<circle cx="5" cy="5" r="1.5" />
			<path d="M5 6.5v11" />
			<path d="M5 12h7" />
			<path d="M5 18h7" />
			<circle cx="14" cy="12" r="1.5" />
			<circle cx="14" cy="18" r="1.5" />
		</svg>
	),
	evaluate: (
		<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<path d="M4 14a8 8 0 0 1 16 0" />
			<path d="M12 14l3-4" />
			<circle cx="12" cy="14" r="0.9" fill="currentColor" />
		</svg>
	),
	agent: (
		<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<path d="M12 3l2.2 5.4L20 10.5l-5.8 2.1L12 18l-2.2-5.4L4 10.5l5.8-2.1z" />
			<path d="M19 3v3M20.5 4.5h-3" />
		</svg>
	),
	deals: (
		<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<path d="m4 17 4-4 3 3 7-8" />
			<path d="M14 8h4v4" />
		</svg>
	),
};

type PgTabId = "search" | "sourcing" | "appraise" | "evaluate" | "agent" | "deals";

const PG_TABS: ReadonlyArray<ComposeTab<PgTabId>> = [
	{
		id: "search",
		label: "Search",
		icon: PG_TAB_ICONS.search,
		caption: "Type a keyword to find listings. Active or sold.",
	},
	{
		id: "sourcing",
		label: "Sourcing",
		icon: PG_TAB_ICONS.sourcing,
		caption: "No keyword in mind? Browse by category to see what's selling there.",
	},
	{
		id: "appraise",
		label: "Worth",
		icon: PG_TAB_ICONS.evaluate,
		caption: "What's this product worth? Title or URL — flipagent resolves the catalog and reads the market.",
	},
	{
		id: "evaluate",
		label: "Buy decision",
		icon: PG_TAB_ICONS.evaluate,
		caption: "Pick a listing. Get its profit, sell-through, and a buy or skip call.",
	},
	{
		id: "deals",
		label: "Top deals",
		icon: PG_TAB_ICONS.deals,
		caption: "Browse evaluations across the platform, sorted by expected net profit.",
	},
	{
		id: "agent",
		label: "Agent",
		icon: PG_TAB_ICONS.agent,
	},
];

/**
 * Frames Search + Sourcing + Evaluate. Each panel renders its own
 * ComposeCard + Tabs (so it can position QuickStarts/RecentRuns below
 * the card on its own). PlaygroundShell mounts all three and toggles
 * visibility — form state and trace history survive across tab
 * switches.
 */
function PlaygroundShell({
	active,
	onChange,
	evaluateSeed,
	onEvaluate,
	agentSeed,
}: {
	active: PgTabId;
	onChange: (next: PgTabId) => void;
	evaluateSeed: string | null;
	onEvaluate: (itemId: string) => void;
	agentSeed: string | null;
}) {
	const tabsProps = { tabs: PG_TABS, active, onChange } as const;
	return (
		<>
			<div className={active === "search" ? "" : "hidden"}>
				<PlaygroundSearch tabsProps={tabsProps} />
			</div>
			<div className={active === "sourcing" ? "" : "hidden"}>
				<PlaygroundSourcing tabsProps={tabsProps} />
			</div>
			<div className={active === "appraise" ? "" : "hidden"}>
				<PlaygroundAppraise tabsProps={tabsProps} />
			</div>
			<div className={active === "evaluate" ? "" : "hidden"}>
				<PlaygroundEvaluate tabsProps={tabsProps} seed={evaluateSeed} />
			</div>
			{active === "deals" && <PlaygroundDeals tabsProps={tabsProps} />}
			<div className={active === "agent" ? "" : "hidden"}>
				<PlaygroundAgent tabsProps={tabsProps} seedPrompt={agentSeed ?? undefined} />
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
	const [modalOpen, setModalOpen] = useState(false);
	// Cache: id → decrypted plaintext. Survives reveal toggle so copy doesn't
	// re-hit the server, and reveal flips back on without a round-trip.
	const [plaintexts, setPlaintexts] = useState<Map<string, string>>(new Map());
	// Which rows are currently displaying their plaintext. Distinct from the
	// cache — copying shouldn't make the row reveal itself.
	const [visible, setVisible] = useState<Set<string>>(new Set());

	async function revoke(id: string) {
		if (!confirm("Revoke this key? Any agents using it will start failing immediately.")) return;
		try {
			await apiFetch(`/v1/me/keys/${id}`, { method: "DELETE" });
			setPlaintexts((prev) => {
				const next = new Map(prev);
				next.delete(id);
				return next;
			});
			setVisible((prev) => {
				const next = new Set(prev);
				next.delete(id);
				return next;
			});
			await refresh();
		} catch (err) {
			onError(err instanceof Error ? err.message : String(err));
		}
	}
	async function fetchPlaintext(id: string): Promise<string | null> {
		const cached = plaintexts.get(id);
		if (cached) return cached;
		try {
			const res = await apiFetch<{ id: string; plaintext: string }>(`/v1/me/keys/${id}/reveal`, { method: "POST" });
			setPlaintexts((prev) => new Map(prev).set(id, res.plaintext));
			return res.plaintext;
		} catch (err) {
			const status = (err as { status?: number } | null)?.status;
			if (status === 410) {
				toast.error("This key was created before reveal was wired — recreate to view.");
			} else if (status === 503) {
				toast.error("Reveal isn't configured on this host.");
			} else {
				toast.error(err instanceof Error ? err.message : String(err));
			}
			return null;
		}
	}
	async function toggleReveal(id: string) {
		if (visible.has(id)) {
			setVisible((prev) => {
				const next = new Set(prev);
				next.delete(id);
				return next;
			});
			return;
		}
		const plaintext = await fetchPlaintext(id);
		if (plaintext) {
			setVisible((prev) => new Set(prev).add(id));
		}
	}
	async function copyKey(id: string, prefix: string) {
		const plaintext = await fetchPlaintext(id);
		const value = plaintext ?? prefix;
		try {
			await navigator.clipboard.writeText(value);
			toast.success(plaintext ? "Key copied to clipboard." : "Key prefix copied (full key unavailable).");
		} catch {
			toast.error("Could not copy to clipboard.");
		}
	}

	return (
		<>
			<section className="dash-page-head">
				<h1>API keys</h1>
				<p>Bearer tokens scoped to your account. Click the eye to reveal the full key.</p>
			</section>
			<div className="dash-card">
				<header className="dash-keys-head">
					<h2>Your API keys</h2>
					<button type="button" className="dash-btn" onClick={() => setModalOpen(true)}>
						<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
							<path d="M8 3v10M3 8h10" />
						</svg>
						<span>Create</span>
					</button>
				</header>
				<ul className="dash-keys">
					{keys.length === 0 && (
						<li className="dash-keys-empty">No keys yet. Click <strong>+ Create</strong> to make one.</li>
					)}
					{keys.map((k) => {
						const isRevealed = visible.has(k.id);
						const plaintext = isRevealed ? plaintexts.get(k.id) : undefined;
						const masked = k.suffix
							? `${"·".repeat(28)}${k.suffix}`
							: "·".repeat(28);
						return (
							<li key={k.id} className="dash-key">
								<div className="dash-key-name">{k.name ?? "(unnamed)"}</div>
								<div className="dash-key-display">
									<code className="dash-key-mask">
										{plaintext ?? masked}
									</code>
									<button
										type="button"
										className="dash-icon-btn"
										onClick={() => toggleReveal(k.id)}
										aria-label={isRevealed ? "Hide key" : "Reveal key"}
										title={isRevealed ? "Hide key" : "Reveal key"}
									>
										{isRevealed ? <EyeOffIcon /> : <EyeIcon />}
									</button>
									<button
										type="button"
										className="dash-icon-btn"
										onClick={() => copyKey(k.id, k.prefix)}
										aria-label="Copy key"
										title="Copy key"
									>
										<CopyIcon />
									</button>
								</div>
								<div className="dash-key-meta">
									<span>Created {new Date(k.createdAt).toLocaleDateString()}</span>
									<span aria-hidden="true">·</span>
									<span>Last used {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : "never"}</span>
									<button type="button" className="dash-key-revoke" onClick={() => revoke(k.id)}>
										Revoke
									</button>
								</div>
							</li>
						);
					})}
				</ul>
			</div>
			{modalOpen && (
				<CreateKeyModal
					issued={issued}
					onClose={() => {
						setModalOpen(false);
						setIssued(null);
					}}
					onCreated={async (k) => {
						setIssued(k);
						await refresh();
					}}
					onError={onError}
				/>
			)}
		</>
	);
}

/* ─────────── Connected devices ─────────── */

type DeviceRow = {
	id: string;
	deviceName: string | null;
	tokenPrefix: string;
	ebayLoggedIn: boolean;
	ebayUserName: string | null;
	createdAt: string;
	lastSeenAt: string | null;
};

/**
 * Connected devices = active bridge tokens. One row per Chrome extension
 * instance the user OAuth'd through `/extension/connect`. Mirrors the
 * KeysPanel structure (header + dash-card + list with revoke action) so
 * a future redesign of one picks the other up for free.
 */
function DevicesPanel({ onError }: { onError: (s: string | null) => void }) {
	const [rows, setRows] = useState<DeviceRow[]>([]);
	const [loading, setLoading] = useState(true);

	async function refresh() {
		try {
			const res = await apiFetch<{ devices: DeviceRow[] }>("/v1/me/devices");
			setRows(res.devices);
		} catch (err) {
			onError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		void refresh();
	}, []);

	async function revoke(id: string) {
		if (!confirm("Revoke this device? The Chrome extension on that machine will stop polling.")) return;
		try {
			await apiFetch(`/v1/me/devices/${id}`, { method: "DELETE" });
			await refresh();
		} catch (err) {
			onError(err instanceof Error ? err.message : String(err));
		}
	}

	return (
		<>
			<section className="dash-page-head">
				<h1>Devices</h1>
				<p>Browsers paired with flipagent through the Chrome extension. Revoke any device to stop it from polling.</p>
			</section>
			<div className="dash-card">
				<header className="dash-keys-head">
					<h2>Connected devices</h2>
				</header>
				<ul className="dash-keys">
					{loading && <li className="dash-keys-empty">Loading…</li>}
					{!loading && rows.length === 0 && (
						<li className="dash-keys-empty">
							No devices yet. Install the Chrome extension and click <strong>Sign in to flipagent</strong> in its popup.
						</li>
					)}
					{rows.map((d) => {
						const last = d.lastSeenAt ? new Date(d.lastSeenAt) : null;
						const lastStr = last ? last.toLocaleString() : "never";
						const ebayLine = d.ebayLoggedIn
							? `eBay signed in${d.ebayUserName ? ` as ${d.ebayUserName}` : ""}`
							: "eBay not signed in";
						return (
							<li key={d.id} className="dash-key">
								<div className="dash-key-name">{d.deviceName ?? "(unnamed)"}</div>
								<div className="dash-key-display">
									<code className="dash-key-mask">{d.tokenPrefix}{"·".repeat(20)}</code>
								</div>
								<div className="dash-key-meta">
									<span>Connected {new Date(d.createdAt).toLocaleDateString()}</span>
									<span aria-hidden="true">·</span>
									<span>Last seen {lastStr}</span>
									<span aria-hidden="true">·</span>
									<span>{ebayLine}</span>
									<button type="button" className="dash-key-revoke" onClick={() => revoke(d.id)}>
										Revoke
									</button>
								</div>
							</li>
						);
					})}
				</ul>
			</div>
		</>
	);
}

/**
 * Generic modal shell — header + body, ESC/backdrop close, scroll-lock.
 * Style is shadcn-flavored: centered card, subtle shadow, click-outside +
 * Escape both dismiss. Use for any in-dashboard dialog (create-key,
 * change-password, future destructive-action confirms).
 */
function Modal({
	title,
	onClose,
	children,
}: {
	title: string;
	onClose: () => void;
	children: React.ReactNode;
}) {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		const prevOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			window.removeEventListener("keydown", onKey);
			document.body.style.overflow = prevOverflow;
		};
	}, [onClose]);

	return (
		<div
			className="dash-modal-backdrop"
			onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
		>
			<div className="dash-modal" role="dialog" aria-modal="true" aria-labelledby="dash-modal-title">
				<header className="dash-modal-head">
					<h2 id="dash-modal-title">{title}</h2>
					<button type="button" className="dash-icon-btn" onClick={onClose} aria-label="Close">
						<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
							<path d="M3 3l10 10M13 3L3 13" />
						</svg>
					</button>
				</header>
				{children}
			</div>
		</div>
	);
}

function CreateKeyModal({ issued, onClose, onCreated, onError }: {
	issued: IssuedKey | null;
	onClose: () => void;
	onCreated: (k: IssuedKey) => Promise<void>;
	onError: (s: string | null) => void;
}) {
	const [name, setName] = useState("");
	const [pending, setPending] = useState(false);

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		setPending(true);
		onError(null);
		try {
			const res = await apiFetch<IssuedKey>("/v1/me/keys", {
				method: "POST",
				body: JSON.stringify({ name: name.trim() || undefined }),
			});
			await onCreated(res);
			setName("");
		} catch (err) {
			onError(err instanceof Error ? err.message : String(err));
		} finally {
			setPending(false);
		}
	}

	async function copyPlaintext() {
		if (!issued) return;
		try {
			await navigator.clipboard.writeText(issued.plaintext);
			toast.success("Key copied to clipboard.");
		} catch {
			toast.error("Could not copy to clipboard.");
		}
	}

	return (
		<Modal title={issued ? "Key created" : "Create API key"} onClose={onClose}>
			{issued ? (
				<div className="dash-modal-body">
					<p className="dash-modal-note">Save this now — it won't be shown again.</p>
					<code className="dash-issued-key">{issued.plaintext}</code>
					<div className="dash-modal-actions">
						<button type="button" className="dash-btn" onClick={copyPlaintext}>Copy</button>
						<button type="button" className="dash-btn dash-btn--brand" onClick={onClose}>Done</button>
					</div>
				</div>
			) : (
				<form className="dash-modal-body" onSubmit={submit}>
					<label className="dash-field">
						<span>Key name</span>
						<input
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="e.g. production, ci, dev"
							maxLength={80}
							autoFocus
						/>
					</label>
					<p className="dash-modal-hint">Give your key a descriptive name to help you identify it later.</p>
					<div className="dash-modal-actions">
						<button type="submit" className="dash-btn dash-btn--brand" disabled={pending}>
							{pending ? "Creating…" : "Create key"}
						</button>
					</div>
				</form>
			)}
		</Modal>
	);
}

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirm, setConfirm] = useState("");
	const [pending, setPending] = useState(false);

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		if (newPassword.length < 8) {
			toast.error("New password must be at least 8 characters.");
			return;
		}
		if (newPassword !== confirm) {
			toast.error("Passwords don't match.");
			return;
		}
		setPending(true);
		try {
			await authClient.changePassword({ currentPassword, newPassword });
			toast.success("Password updated.");
			onClose();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : String(err));
			setPending(false);
		}
	}

	return (
		<Modal title="Change password" onClose={onClose}>
			<form className="dash-modal-body" onSubmit={submit}>
				<label className="dash-field">
					<span>Current password</span>
					<input
						type="password"
						autoComplete="current-password"
						value={currentPassword}
						onChange={(e) => setCurrentPassword(e.target.value)}
						required
						autoFocus
					/>
				</label>
				<label className="dash-field">
					<span>New password</span>
					<input
						type="password"
						autoComplete="new-password"
						value={newPassword}
						onChange={(e) => setNewPassword(e.target.value)}
						required
						minLength={8}
					/>
				</label>
				<label className="dash-field">
					<span>Confirm new password</span>
					<input
						type="password"
						autoComplete="new-password"
						value={confirm}
						onChange={(e) => setConfirm(e.target.value)}
						required
						minLength={8}
					/>
				</label>
				<p className="dash-modal-hint">At least 8 characters.</p>
				<div className="dash-modal-actions">
					<button type="button" className="dash-btn" onClick={onClose}>Cancel</button>
					<button type="submit" className="dash-btn dash-btn--brand" disabled={pending}>
						{pending ? "Updating…" : "Update password"}
					</button>
				</div>
			</form>
		</Modal>
	);
}

function EyeIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
			<circle cx="8" cy="8" r="2" />
		</svg>
	);
}
function EyeOffIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d="M2 2l12 12" />
			<path d="M3.2 5.5C2 6.8 1.5 8 1.5 8s2.5 4.5 6.5 4.5c1.2 0 2.3-.4 3.2-.9" />
			<path d="M6.4 4c.5-.2 1-.3 1.6-.3 4 0 6.5 4.3 6.5 4.3s-.5.9-1.5 1.9" />
			<path d="M9.5 9.5a2 2 0 0 1-3-3" />
		</svg>
	);
}
function CopyIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<rect x="5" y="5" width="9" height="9" rx="1.5" />
			<path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2H3.5A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
		</svg>
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

// Credit cost per call by endpoint, mirroring auth/limits.ts:creditsForEndpoint.
// Used in the breakdown table to render `count × credits = total` for each
// endpoint. Keep in sync with the server-side function.
function creditsForEndpoint(endpoint: string): number {
	if (endpoint.startsWith("/v1/evaluate")) return 80;
	if (endpoint.startsWith("/v1/items")) return 1;
	if (endpoint.startsWith("/v1/products")) return 1;
	if (endpoint.startsWith("/v1/marketplaces/ebay/catalog")) return 1;
	if (endpoint.startsWith("/v1/categories")) return 1;
	if (endpoint.startsWith("/v1/trends")) return 1;
	return 0;
}

function UsagePanel({ profile }: { profile: Profile }) {
	const used = profile.usage.creditsUsed;
	const limit = profile.usage.creditsLimit;
	const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
	const level = pct >= 95 ? "danger" : pct >= 80 ? "warn" : "ok";

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

	// Order endpoints by total credits spent, not call count — cheap calls
	// shouldn't crowd out the expensive ones at the top of the breakdown.
	const ranked = breakdown
		? [...breakdown]
				.map((r) => ({ ...r, credits: r.count * creditsForEndpoint(r.endpoint) }))
				.sort((a, b) => b.credits - a.credits)
		: null;
	const maxCredits = ranked && ranked.length > 0 ? Math.max(...ranked.map((r) => r.credits)) : 1;

	return (
		<>
			<section className="dash-page-head">
				<h1>Usage</h1>
				<p>
					{profile.usage.resetAt
						? `Resets ${new Date(profile.usage.resetAt).toLocaleDateString()} (UTC).`
						: "Free tier credits are a one-time grant — they don't refill. Upgrade for monthly credits."}
				</p>
			</section>

			<div className="dash-card">
				<div className="dash-card-eyebrow">This month</div>
				<div className="dash-card-h2">
					{used.toLocaleString()} <span className="dash-of">/ {limit.toLocaleString()} credits</span>
				</div>
				<div className="dash-bar">
					<div className={`dash-bar-fill dash-bar-fill--${level}`} style={{ width: `${pct}%` }} />
				</div>
			</div>

			<div className="dash-card">
				<div className="dash-card-eyebrow">By endpoint</div>
				<div className="dash-card-h2">
					{ranked ? `${ranked.length} unique paths` : "Loading…"}
				</div>
				{error && <p className="dash-muted">Couldn't load: {error}</p>}
				{ranked && ranked.length === 0 && (
					<p className="dash-muted">No metered calls yet this month. Try the Search playground.</p>
				)}
				{ranked && ranked.length > 0 && (
					<ul className="dash-bars">
						{ranked.map((row) => {
							const widthPct = Math.max(4, Math.round((row.credits / maxCredits) * 100));
							const errPct = row.count > 0 ? Math.round((row.errorCount / row.count) * 100) : 0;
							const perCall = creditsForEndpoint(row.endpoint);
							return (
								<li key={row.endpoint} className="dash-bars-row">
									<div className="dash-bars-head">
										<code className="dash-bars-endpoint">{row.endpoint}</code>
										<span className="dash-bars-count">
											{row.count.toLocaleString()} × {perCall} = {row.credits.toLocaleString()} credits
										</span>
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
								const replayable = e.endpoint.startsWith("/v1/items") || e.endpoint.startsWith("/v1/categories") || e.endpoint.startsWith("/v1/products") || e.endpoint.startsWith("/v1/marketplaces/ebay/catalog");
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

/* ─────────── Settings ─────────── */

function SettingsPanel({
	profile,
	ebay,
	keys,
	features,
	onError,
	refreshEbay,
	refreshProfile,
	onGoto,
}: {
	profile: Profile;
	ebay: EbayStatus | null;
	keys: KeyRow[];
	features: Features;
	onError: (s: string | null) => void;
	refreshEbay: () => Promise<void>;
	refreshProfile: () => Promise<void>;
	onGoto: (view: View) => void;
}) {
	const [pwModalOpen, setPwModalOpen] = useState(false);
	const [pendingResend, setPendingResend] = useState(false);
	const [ebayBusy, setEbayBusy] = useState(false);
	const [ebayConsentOpen, setEbayConsentOpen] = useState(false);
	const [ebayConsentAgreed, setEbayConsentAgreed] = useState(false);
	const [billingBusy, setBillingBusy] = useState<string | null>(null);

	// Deep-link handoff from the extension popup. Dashboard sets the
	// sessionStorage flag when the URL had `?connect=ebay`; we open the
	// consent modal once on mount and clear the flag.
	useEffect(() => {
		if (sessionStorage.getItem("flipagent_open_ebay_connect")) {
			sessionStorage.removeItem("flipagent_open_ebay_connect");
			setEbayConsentAgreed(false);
			setEbayConsentOpen(true);
			requestAnimationFrame(() => {
				document.getElementById("settings-ebay")?.scrollIntoView({ behavior: "smooth", block: "center" });
			});
		}
	}, []);

	async function resendVerify() {
		setPendingResend(true);
		try {
			await authClient.sendVerificationEmail({
				email: profile.email,
				callbackURL: `${window.location.origin}/dashboard/?verified=1`,
			});
			toast.success(`Verification link sent to ${profile.email}.`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : String(err));
		} finally {
			setPendingResend(false);
		}
	}

	function ebayConnect() {
		// JIT consent gate. The backend `?ack=` param mirrors the
		// EBAY_CONNECT_DISCLAIMER_VERSION constant on the api side; bumping
		// either requires bumping both. The modal copy reflects the same
		// three-line disclosure that lives in /legal/terms#connected-ebay-account.
		setEbayConsentAgreed(false);
		setEbayConsentOpen(true);
	}
	function ebayConnectConfirmed() {
		setEbayConsentOpen(false);
		const ack = EBAY_CONNECT_DISCLAIMER_VERSION;
		const redirect = encodeURIComponent(window.location.origin + "/dashboard/");
		window.location.href = `${apiBase}/v1/me/ebay/connect?ack=${ack}&redirect=${redirect}`;
	}
	async function ebayDisconnect() {
		if (!confirm("Disconnect eBay? Tokens removed locally; eBay-side authorization stays (revoke at eBay if needed).")) return;
		setEbayBusy(true);
		try {
			await apiFetch("/v1/me/ebay/connect", { method: "DELETE" });
			await refreshEbay();
			toast.success("Disconnected.");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : String(err));
		} finally {
			setEbayBusy(false);
		}
	}

	async function upgrade(plan: "hobby" | "standard" | "growth") {
		setBillingBusy(plan);
		onError(null);
		try {
			const res = await apiFetch<{ url: string }>("/v1/billing/checkout", {
				method: "POST",
				body: JSON.stringify({ tier: plan }),
			});
			window.location.href = res.url;
		} catch (err) {
			onError(err instanceof Error ? err.message : String(err));
			setBillingBusy(null);
		}
	}
	async function billingPortal() {
		setBillingBusy("portal");
		try {
			const res = await apiFetch<{ url: string }>("/v1/billing/portal", { method: "POST" });
			window.location.href = res.url;
		} catch (err) {
			onError(err instanceof Error ? err.message : String(err));
			setBillingBusy(null);
		}
	}

	return (
		<>
			<section className="dash-page-head">
				<h1>Settings</h1>
			</section>

			{/* Account: identity + plan/billing + password — one card.
				Each item inside is a `.dash-card-row` (label h3 + value
				p + optional action) so the visual weight matches the
				eBay and Auto-recharge cards exactly. */}
			<div className="dash-card" id="settings-account">
				<div className="dash-card-eyebrow">Account</div>

				{profile.name && (
					<div className="dash-card-row">
						<div className="dash-card-row-text">
							<h3>Name</h3>
							<p>{profile.name}</p>
						</div>
					</div>
				)}

				<div className="dash-card-row">
					<div className="dash-card-row-text">
						<h3>Email</h3>
						<p>
							{profile.email} · {profile.emailVerified ? "Verified" : "Not verified"}
						</p>
					</div>
					{!profile.emailVerified && features.betterAuth && (
						<button type="button" className="dash-btn" onClick={resendVerify} disabled={pendingResend}>
							{pendingResend ? "Sending…" : "Resend link"}
						</button>
					)}
				</div>

				<div className="dash-card-row">
					<div className="dash-card-row-text">
						<h3>Plan</h3>
						<p>
							<span className="dash-tier-pill" data-tier={profile.tier}>
								{profile.tier.toUpperCase()}
							</span>
						</p>
					</div>
					{features.stripe && profile.tier === "free" && (
						<div className="dash-actions">
							<button
								type="button"
								className="dash-btn"
								onClick={() => upgrade("hobby")}
								disabled={billingBusy !== null}
							>
								{billingBusy === "hobby" ? "Opening…" : "Upgrade to Hobby"}
							</button>
							<button
								type="button"
								className="dash-btn dash-btn--brand"
								onClick={() => upgrade("standard")}
								disabled={billingBusy !== null}
							>
								{billingBusy === "standard" ? "Opening…" : "Upgrade to Standard"}
							</button>
						</div>
					)}
					{features.stripe && (profile.tier === "hobby" || profile.tier === "standard" || profile.tier === "growth") && (
						<button type="button" className="dash-btn" onClick={billingPortal} disabled={billingBusy !== null}>
							{billingBusy === "portal" ? "Opening…" : "Manage billing"}
						</button>
					)}
				</div>

				<div className="dash-card-divider" />
				<div className="dash-actions">
					{features.betterAuth && (
						<button type="button" className="dash-btn" onClick={() => setPwModalOpen(true)}>
							Change password
						</button>
					)}
					<button
						type="button"
						className="dash-btn"
						onClick={() => signOut().finally(() => (window.location.href = "/"))}
					>
						Sign out
					</button>
				</div>
			</div>

			{pwModalOpen && (
				<ChangePasswordModal onClose={() => setPwModalOpen(false)} />
			)}

			{features.stripe && (
				<BillingTopUp
					tier={profile.tier}
					onError={onError}
					// Auto-recharge fires off-session PaymentIntents from
					// middleware; refresh the profile after a config save
					// so any landing credit_grants rows surface in the
					// usage gauge without a hard reload.
					onChanged={refreshProfile}
				/>
			)}

			{/* eBay — scope table is always visible. The disconnected state
				doesn't mean "nothing works": browse + sold are scrape-backed and
				active out of the box. The table communicates that directly so
				users see the actual ground truth instead of a vague CTA. */}
			<div className="dash-card" id="settings-ebay">
				<div className="dash-card-eyebrow">eBay account</div>

				{/* OAuth row — sell-side authorization. */}
				<div className="dash-card-row">
					<div className="dash-card-row-text">
						<h3>
							{!features.ebayOAuth
								? "Not configured on this host"
								: ebay?.oauth.connected
									? `Connected${ebay.oauth.ebayUserName ? ` as @${ebay.oauth.ebayUserName}` : ""}`
									: "Connect your eBay account"}
						</h3>
						<p>
							{!features.ebayOAuth ? (
								<>
									<code>EBAY_CLIENT_ID</code> / <code>EBAY_CLIENT_SECRET</code> / <code>EBAY_RU_NAME</code>{" "}
									unset. Sell-side endpoints return <code>503</code>. See{" "}
									<a href="/docs/self-host/">self-host docs</a>.
								</>
							) : ebay?.oauth.connected && ebay.oauth.accessTokenExpiresAt ? (
								`Token refreshes ${new Date(ebay.oauth.accessTokenExpiresAt).toLocaleString()}.`
							) : (
								"Authorize flipagent to manage listings, orders, and payouts on your behalf."
							)}
						</p>
					</div>
					{features.ebayOAuth && !ebay?.oauth.connected && (
						<button
							type="button"
							className="dash-btn dash-btn--brand"
							onClick={ebayConnect}
							disabled={keys.length === 0}
							title={keys.length === 0 ? "Create an API key first" : undefined}
						>
							Connect
						</button>
					)}
					{features.ebayOAuth && ebay?.oauth.connected && (
						<button
							type="button"
							className="dash-btn"
							onClick={ebayDisconnect}
							disabled={ebayBusy}
						>
							{ebayBusy ? "Disconnecting…" : "Disconnect"}
						</button>
					)}
				</div>

				{/* Browser-extension row — buy-side bridge, separate
					concept from OAuth above. Only render when the host
					supports OAuth (otherwise the whole eBay flow is dead
					and the card is just an env-config hint). */}
				{features.ebayOAuth && ebay && <BridgeRow ebay={ebay} onGoto={onGoto} />}
			</div>

			{/* Billing History — at the bottom, below the eBay card.
				Stripe subscription invoices + auto-recharge top-up
				receipts in one newest-first table. Self-hosts without
				Stripe see nothing (component returns null). */}
			<BillingHistory stripeEnabled={features.stripe} onError={onError} />

			<EbayConnectConsentModal
				open={ebayConsentOpen}
				agreed={ebayConsentAgreed}
				onAgreedChange={setEbayConsentAgreed}
				onCancel={() => setEbayConsentOpen(false)}
				onConfirm={ebayConnectConfirmed}
			/>
		</>
	);
}


/**
 * Browser-extension status row inside the eBay account card. Distinct
 * from OAuth (the heading row above): the bridge runs in the user's
 * own Chrome, drives buy-side flows, and has its own three-state model
 * (not installed / paired but signed out / active).
 *
 * Lives inline as a `.dash-card-row` so the visual pattern matches
 * every other row in the Settings panel.
 */
function BridgeRow({ ebay, onGoto }: { ebay: EbayStatus; onGoto: (view: View) => void }) {
	const state: "active" | "needs_signin" | "not_installed" = !ebay.bridge.paired
		? "not_installed"
		: ebay.bridge.ebayLoggedIn
			? "active"
			: "needs_signin";

	// Parallel phrasing across all three states — each one explains
	// what the bridge actually does (buy items + private data fetches
	// via the user's own Chrome) so the row reads as a benefit, not a
	// status code. Device + user details fold in as context.
	const device = ebay.bridge.deviceName ?? "your device";
	const userSuffix = ebay.bridge.ebayUserName ? ` (signed in as @${ebay.bridge.ebayUserName})` : "";
	const description =
		state === "active"
			? `Lets flipagent buy items and fetch private data through your Chrome on ${device}${userSuffix}.`
			: state === "needs_signin"
				? `Paired on ${device}. Sign in to eBay to let flipagent buy items and fetch private data through your Chrome.`
				: "Lets flipagent buy items and fetch private data through your own Chrome session. Optional.";

	return (
		<>
			<div className="dash-card-divider" />
			<div className="dash-card-row">
				<div className="dash-card-row-text">
					<h3>Browser extension</h3>
					<p>{description}</p>
				</div>
				{state === "not_installed" && (
					<a href="/docs/extension/" className="dash-btn">
						Install extension
					</a>
				)}
				{state === "needs_signin" && (
					<a href="https://www.ebay.com/signin" target="_blank" rel="noopener noreferrer" className="dash-btn">
						Open eBay
					</a>
				)}
				{state === "active" && (
					<button type="button" className="dash-btn" onClick={() => onGoto("devices")}>
						Manage devices
					</button>
				)}
			</div>
		</>
	);
}

