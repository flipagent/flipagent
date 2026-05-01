/**
 * Outbound email via Resend. Used by Better-Auth for password reset and
 * (future) email verification. Returns null when RESEND_API_KEY is unset —
 * callers must check and surface the appropriate "not configured" error.
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
