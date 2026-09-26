"use server";

import { cookies, headers } from "next/headers";
import { supabaseServer, supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { getHostTenant } from "@/lib/tenant/hostTenant";
import { checkAndRecordAttempt, isDistinguishingClientIp, type RateLimitResult } from "@/lib/security/rateLimiter";
import { SESSION_STARTED_COOKIE, SESSION_LAST_SEEN_COOKIE } from "@/lib/tenant/sessionSecurity";

type AuthActionResult = { ok: true } | { ok: false; error: string };

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/**
 * Server-resolved origin for building the password-reset email's redirect
 * link. Reads the platform-supplied forwarding headers (Vercel sets both)
 * rather than trusting anything client-submitted, consistent with never
 * trusting a client-supplied value for something security-relevant
 * (CLAUDE.md non-negotiable #2's spirit, applied here to a redirect target
 * rather than tenant_id).
 */
async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3100";
  const proto = h.get("x-forwarded-proto") ?? (process.env.NODE_ENV === "production" ? "https" : "http");
  return `${proto}://${host}`;
}

const SIGNIN_LIMIT = { maxAttempts: 10, windowSeconds: 5 * 60 };
const SIGNUP_LIMIT = { maxAttempts: 5, windowSeconds: 60 * 60 };
const PASSWORD_RESET_LIMIT = { maxAttempts: 5, windowSeconds: 60 * 60 };

/**
 * FOUNDATION-P0-05.3 — sign-in is now routed through this server action
 * (rather than a client component calling supabase.auth.signInWithPassword
 * directly) specifically so a rate limit can be enforced before any
 * credential is checked. Rate-limited per email AND per client IP — either
 * bucket tripping blocks the attempt, so a distributed credential-stuffing
 * attempt against one account from many IPs is still caught by the email
 * bucket, and a single-IP attempt against many accounts is caught by the IP
 * bucket.
 */
export async function signInAction(email: string, password: string): Promise<AuthActionResult> {
  const ip = await clientIp();
  const checks: Promise<RateLimitResult>[] = [checkAndRecordAttempt("signin:email", email.toLowerCase(), SIGNIN_LIMIT)];
  // Skip the IP bucket entirely when the resolved address can't distinguish
  // one visitor from another (see isDistinguishingClientIp) — otherwise a
  // burst of attempts from anyone sharing that non-distinguishing address
  // (or, on this project, an intermediary that reports the same loopback
  // address for every request) locks out every other visitor too. The
  // per-email bucket above still fully protects each individual account.
  if (isDistinguishingClientIp(ip)) checks.push(checkAndRecordAttempt("signin:ip", ip, SIGNIN_LIMIT));
  const results = await Promise.all(checks);
  if (results.some((r) => !r.allowed)) {
    return { ok: false, error: "Too many sign-in attempts. Please try again in a few minutes." };
  }

  // FOUNDATION-P0-22 — on an organization's own address: an address that
  // names no organization, or a suspended one, cannot be signed in to at
  // all; and an account that is not an active member there is signed
  // straight back out (the address never grants access).
  const host = await getHostTenant();
  const onTenantAddress = host.target.kind === "subdomain" || host.target.kind === "invalid";
  if (onTenantAddress && !host.tenant) return { ok: false, error: "No organization is at this address." };
  if (onTenantAddress && host.tenant!.status !== "active") return { ok: false, error: `${host.tenant!.name} is suspended. Sign-in is paused; contact your administrator.` };

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: error.message };

  if (onTenantAddress && data.user) {
    // The person just authenticated, reading their own membership in the
    // addressed organization. Service role: a membership that is not yet
    // active (an invitation) is outside their RLS view.
    const { data: membership } = await supabaseServiceRole()
      .from("tenant_memberships")
      .select("status")
      .eq("tenant_id", host.tenant!.tenantId)
      .eq("user_id", data.user.id)
      .maybeSingle();
    // An invitation lets them in far enough to accept it (FOUNDATION-P0-23).
    if (membership?.status !== "active" && membership?.status !== "invited") {
      // Only this new session ends; the account's other sessions are not touched.
      await supabase.auth.signOut({ scope: "local" });
      await writeAudit({
        tenantId: host.tenant!.tenantId,
        actorId: data.user.id,
        actorType: "user",
        action: "auth.sign_in_refused",
        objectType: "tenant",
        objectId: host.tenant!.tenantId,
        outcome: "failure",
        metadata: { reason: membership ? `membership ${membership.status}` : "not a member" },
      });
      return { ok: false, error: `This account is not an active member of ${host.tenant!.name}.` };
    }
  }
  await stampSessionCookies();
  return { ok: true };
}

/**
 * FOUNDATION-P0-09 — stamps the session-start/last-activity cookies used by
 * proxy.ts to enforce idle and absolute session expiry on top of Supabase
 * Auth's own JWT expiry/refresh. Called from every path that establishes a
 * new authenticated session (password sign-in here; the SSO callback route
 * calls the equivalent logic itself since it doesn't go through this
 * server action).
 */
async function stampSessionCookies() {
  const cookieStore = await cookies();
  const now = Date.now().toString();
  const cookieOpts = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
  cookieStore.set(SESSION_STARTED_COOKIE, now, cookieOpts);
  cookieStore.set(SESSION_LAST_SEEN_COOKIE, now, cookieOpts);
}

export async function signUpAction(email: string, password: string): Promise<AuthActionResult> {
  const ip = await clientIp();
  const checks: Promise<RateLimitResult>[] = [checkAndRecordAttempt("signup:email", email.toLowerCase(), SIGNUP_LIMIT)];
  if (isDistinguishingClientIp(ip)) checks.push(checkAndRecordAttempt("signup:ip", ip, SIGNUP_LIMIT));
  const results = await Promise.all(checks);
  if (results.some((r) => !r.allowed)) {
    return { ok: false, error: "Too many sign-up attempts from this location. Please try again later." };
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * FOUNDATION — forgot-password. Rate-limited the same way as sign-in/
 * sign-up (per-email and, when the client IP is distinguishing, per-IP —
 * see isDistinguishingClientIp), and deliberately returns the same `ok:
 * true` shape whether or not the address has an account: Supabase Auth
 * itself does not reveal account existence through this call (same
 * email-enumeration protection already relied on for sign-up — see
 * auth.spec.ts), and the UI always shows one generic "if an account
 * exists…" message regardless.
 *
 * `redirectTo` carries `next=/update-password` through the existing SSO
 * callback route (app/auth/callback/route.ts) rather than a dedicated
 * callback, so the recovery code-exchange reuses that route's session-
 * cookie stamping instead of duplicating it.
 */
export async function requestPasswordResetAction(email: string): Promise<AuthActionResult> {
  const ip = await clientIp();
  const checks: Promise<RateLimitResult>[] = [
    checkAndRecordAttempt("password-reset:email", email.toLowerCase(), PASSWORD_RESET_LIMIT),
  ];
  if (isDistinguishingClientIp(ip)) checks.push(checkAndRecordAttempt("password-reset:ip", ip, PASSWORD_RESET_LIMIT));
  const results = await Promise.all(checks);
  if (results.some((r) => !r.allowed)) {
    return { ok: false, error: "Too many password reset requests. Please try again later." };
  }

  const origin = await siteOrigin();
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/update-password`,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Completes the forgot-password flow. Requires an active session — the one
 * established by exchanging the recovery link's code in
 * app/auth/callback/route.ts — rather than accepting a token directly, so
 * this action has nothing token-shaped to validate itself; Supabase Auth
 * already refused to issue that session for an invalid/expired/already-used
 * link.
 */
export async function updatePasswordAction(newPassword: string): Promise<AuthActionResult> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "This password reset link has expired or already been used. Request a new one." };
  }
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
