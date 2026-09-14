"use server";

import { cookies, headers } from "next/headers";
import { supabaseServer } from "@/lib/db/supabaseServer";
import { checkAndRecordAttempt } from "@/lib/security/rateLimiter";
import { SESSION_STARTED_COOKIE, SESSION_LAST_SEEN_COOKIE } from "@/lib/tenant/sessionSecurity";

type AuthActionResult = { ok: true } | { ok: false; error: string };

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

const SIGNIN_LIMIT = { maxAttempts: 10, windowSeconds: 5 * 60 };
const SIGNUP_LIMIT = { maxAttempts: 5, windowSeconds: 60 * 60 };

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
  const [emailLimit, ipLimit] = await Promise.all([
    checkAndRecordAttempt("signin:email", email.toLowerCase(), SIGNIN_LIMIT),
    checkAndRecordAttempt("signin:ip", ip, SIGNIN_LIMIT),
  ]);
  if (!emailLimit.allowed || !ipLimit.allowed) {
    return { ok: false, error: "Too many sign-in attempts. Please try again in a few minutes." };
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: error.message };
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
  const [emailLimit, ipLimit] = await Promise.all([
    checkAndRecordAttempt("signup:email", email.toLowerCase(), SIGNUP_LIMIT),
    checkAndRecordAttempt("signup:ip", ip, SIGNUP_LIMIT),
  ]);
  if (!emailLimit.allowed || !ipLimit.allowed) {
    return { ok: false, error: "Too many sign-up attempts from this location. Please try again later." };
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
