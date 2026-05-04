/**
 * Outbound email via Resend. Used by Better-Auth for password reset +
 * email verification (HTML templates below) AND by ops surfaces — the
 * maintenance sweeper's takedown SLA breach alerts and the admin's
 * counter-notice approval — via the generic `sendOpsEmail` at the
 * bottom of the file. One Resend client init, one config gate.
 *
 * Returns null/no-op when `RESEND_API_KEY` is unset; the auth helpers
 * throw `email_not_configured` so the UI can surface it, while the ops
 * helper silently no-ops because operators see the structured warn-log
 * the caller emits regardless.
 *
 * Templates are intentionally plain HTML inline. No React Email dependency.
 */

import { Resend } from "resend";
import { config, isEmailConfigured } from "../config.js";

let cached: Resend | null | undefined;

function getResend(): Resend | null {
	if (cached !== undefined) return cached;
	if (!isEmailConfigured()) {
		cached = null;
		return null;
	}
	cached = new Resend(config.RESEND_API_KEY!);
	return cached;
}

export interface PasswordResetEmailInput {
	to: string;
	name: string | null | undefined;
	resetUrl: string;
}

export async function sendPasswordResetEmail(input: PasswordResetEmailInput): Promise<void> {
	const resend = getResend();
	if (!resend) throw new Error("email_not_configured");
	const greeting = input.name ? `Hi ${input.name},` : "Hi,";
	const html = `
<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:#fafafa;padding:32px;color:#0a0a0a;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #ececec;border-radius:12px;padding:32px;">
    <h1 style="font-size:20px;margin:0 0 16px;font-weight:600;">Reset your flipagent password</h1>
    <p style="font-size:14px;line-height:1.55;margin:0 0 16px;color:#525252;">${greeting} we got a request to reset your password. Click the button below to set a new one — the link is valid for 60 minutes.</p>
    <p style="margin:24px 0;">
      <a href="${input.resetUrl}" style="display:inline-block;background:#ff4c00;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:999px;font-weight:500;font-size:14px;">Reset password</a>
    </p>
    <p style="font-size:12.5px;color:#737373;margin:0 0 8px;">If the button doesn't work, paste this URL into your browser:</p>
    <p style="font-size:12.5px;color:#525252;word-break:break-all;margin:0 0 24px;font-family:'Geist Mono',ui-monospace,Menlo,monospace;">${input.resetUrl}</p>
    <p style="font-size:12px;color:#737373;margin:0;">If you didn't ask for this, ignore this email — your password stays the same.</p>
  </div>
  <p style="text-align:center;font-size:11px;color:#a3a3a3;margin:24px 0 0;">flipagent · hello@flipagent.dev</p>
</body></html>
	`.trim();

	const text = [
		`${greeting} we got a request to reset your flipagent password.`,
		``,
		`Open this link to set a new one (valid for 60 minutes):`,
		input.resetUrl,
		``,
		`If you didn't ask for this, ignore this email.`,
		``,
		`— flipagent`,
	].join("\n");

	const { error } = await resend.emails.send({
		from: config.EMAIL_FROM,
		to: input.to,
		subject: "Reset your flipagent password",
		html,
		text,
	});
	if (error) throw new Error(`resend_failed: ${error.message ?? "unknown"}`);
}

export interface VerificationEmailInput {
	to: string;
	name: string | null | undefined;
	verifyUrl: string;
}

export async function sendVerificationEmail(input: VerificationEmailInput): Promise<void> {
	const resend = getResend();
	if (!resend) throw new Error("email_not_configured");
	const greeting = input.name ? `Hi ${input.name},` : "Hi,";
	const html = `
<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:#fafafa;padding:32px;color:#0a0a0a;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #ececec;border-radius:12px;padding:32px;">
    <h1 style="font-size:20px;margin:0 0 16px;font-weight:600;">Confirm your flipagent email</h1>
    <p style="font-size:14px;line-height:1.55;margin:0 0 16px;color:#525252;">${greeting} thanks for signing up. Click below to confirm this address — the link is valid for 24 hours.</p>
    <p style="margin:24px 0;">
      <a href="${input.verifyUrl}" style="display:inline-block;background:#ff4c00;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:999px;font-weight:500;font-size:14px;">Confirm email</a>
    </p>
    <p style="font-size:12.5px;color:#737373;margin:0 0 8px;">If the button doesn't work, paste this URL into your browser:</p>
    <p style="font-size:12.5px;color:#525252;word-break:break-all;margin:0 0 24px;font-family:'Geist Mono',ui-monospace,Menlo,monospace;">${input.verifyUrl}</p>
    <p style="font-size:12px;color:#737373;margin:0;">If you didn't sign up, ignore this email — no account will be created.</p>
  </div>
  <p style="text-align:center;font-size:11px;color:#a3a3a3;margin:24px 0 0;">flipagent · hello@flipagent.dev</p>
</body></html>
	`.trim();

	const text = [
		`${greeting} thanks for signing up to flipagent.`,
		``,
		`Confirm your email at:`,
		input.verifyUrl,
		``,
		`Link is valid for 24 hours. If you didn't sign up, ignore this email.`,
		``,
		`— flipagent`,
	].join("\n");

	const { error } = await resend.emails.send({
		from: config.EMAIL_FROM,
		to: input.to,
		subject: "Confirm your flipagent email",
		html,
		text,
	});
	if (error) throw new Error(`resend_failed: ${error.message ?? "unknown"}`);
}

export interface AutoRechargeFailedEmailInput {
	to: string;
	name: string | null | undefined;
	/** What we tried to charge — e.g. "$50" — for the message body. */
	amountDisplay: string;
	/** What pack — e.g. "7,500 credits" — so the user knows what was lost. */
	creditsDisplay: string;
	/** Stripe-supplied decline reason where available. Optional — fallback
	 *  to a generic "your card was declined" line when null. */
	declineReason: string | null;
	/** Dashboard URL pointing at the billing/portal flow so the user can
	 *  fix the card in one click. */
	manageBillingUrl: string;
}

/**
 * Sent when an off-session auto-recharge PaymentIntent fails (declined
 * card, expired, 3DS-required, etc.). Auto-recharge has just been
 * disabled by the webhook; this email is the user's first signal —
 * without it they only notice the next time they look at the dashboard
 * and see the toggle off.
 */
export async function sendAutoRechargeFailedEmail(input: AutoRechargeFailedEmailInput): Promise<void> {
	const resend = getResend();
	// Same silent no-op as `sendOpsEmail` — caller (webhook handler)
	// already logs the event, so a missing Resend key shouldn't crash
	// the webhook receiver and trigger Stripe redelivery.
	if (!resend) return;
	const greeting = input.name ? `Hi ${input.name},` : "Hi,";
	const reasonLine = input.declineReason
		? `Stripe said: <em>${escapeHtml(input.declineReason)}</em>.`
		: "Your card was declined by the issuer.";
	const html = `
<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:#fafafa;padding:32px;color:#0a0a0a;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #ececec;border-radius:12px;padding:32px;">
    <h1 style="font-size:20px;margin:0 0 16px;font-weight:600;">Auto-recharge couldn't go through</h1>
    <p style="font-size:14px;line-height:1.55;margin:0 0 12px;color:#525252;">${greeting} we tried to top up your flipagent credits with <strong>${escapeHtml(input.creditsDisplay)}</strong> for <strong>${escapeHtml(input.amountDisplay)}</strong> and the charge didn't go through.</p>
    <p style="font-size:14px;line-height:1.55;margin:0 0 16px;color:#525252;">${reasonLine}</p>
    <p style="font-size:14px;line-height:1.55;margin:0 0 20px;color:#525252;">Auto-recharge is paused until you update your card. Your existing credits are safe — you'll only stop getting more if you actually run out before fixing this.</p>
    <p style="margin:24px 0;">
      <a href="${input.manageBillingUrl}" style="display:inline-block;background:#ff4c00;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:999px;font-weight:500;font-size:14px;">Update card</a>
    </p>
    <p style="font-size:12px;color:#737373;margin:0;">Once you've updated the card, re-enable auto-recharge from the dashboard and we'll pick up where we left off.</p>
  </div>
  <p style="text-align:center;font-size:11px;color:#a3a3a3;margin:24px 0 0;">flipagent · hello@flipagent.dev</p>
</body></html>
	`.trim();
	const text = [
		`${greeting} we tried to top up your flipagent credits with ${input.creditsDisplay} for ${input.amountDisplay} and the charge didn't go through.`,
		input.declineReason ? `Stripe said: ${input.declineReason}.` : "Your card was declined by the issuer.",
		``,
		`Auto-recharge is paused until you update your card. Existing credits stay.`,
		``,
		`Update card: ${input.manageBillingUrl}`,
		``,
		`— flipagent`,
	].join("\n");
	const { error } = await resend.emails.send({
		from: config.EMAIL_FROM,
		to: input.to,
		subject: "Auto-recharge failed — top-ups paused",
		html,
		text,
	});
	if (error) throw new Error(`resend_failed: ${error.message ?? "unknown"}`);
}

export interface OpsEmailInput {
	to: string | string[];
	subject: string;
	/** Plain-text body. Operations email is intentionally text-only — the
	 *  audience is operators, not end users, so the HTML templating noise
	 *  the auth helpers carry is gratuitous here. */
	text: string;
	/** Optional HTML body. Falls back to the text body wrapped in a `<pre>` */
	html?: string;
}

/**
 * Generic Resend send for operations + admin surfaces (sweeper SLA
 * breach alerts, admin counter-notice approval, future incident
 * notifications). Silently no-ops when Resend is unconfigured — callers
 * always emit a parallel structured warn-log so an operator scanning
 * Container Apps logs sees the event regardless of email reachability.
 */
export async function sendOpsEmail(input: OpsEmailInput): Promise<void> {
	const resend = getResend();
	if (!resend) return;
	const { error } = await resend.emails.send({
		from: config.EMAIL_FROM,
		to: input.to,
		subject: input.subject,
		text: input.text,
		html:
			input.html ??
			`<pre style="font:13px ui-monospace,monospace;white-space:pre-wrap;">${escapeHtml(input.text)}</pre>`,
	});
	if (error) throw new Error(`resend_failed: ${error.message ?? "unknown"}`);
}

function escapeHtml(s: string): string {
	return s.replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[m] ?? m);
}
