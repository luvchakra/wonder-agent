import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";

export type RateLimitResult = { allowed: boolean; retryAfterSeconds?: number };

/**
 * Addresses that never identify one real client and must never be used as a
 * rate-limit bucket key: `x-forwarded-for` is absent ("unknown", the
 * `clientIp()` fallback in app/actions/auth.ts) or, observed for real on
 * this project's own traffic (auth_rate_limit_attempts on 2026-09-17), set
 * by an intermediary proxy to a loopback address for every request
 * regardless of who the actual visitor is. Bucketing on a value like that
 * silently merges every unrelated visitor into one counter — ten sign-in
 * attempts by anyone, anywhere, exhausts it and locks out everyone else
 * behind the same proxy for the rest of the window, which reads exactly
 * like "login is broken" to the next real user even though their own
 * credentials and their own attempt count were never the problem.
 */
const NON_DISTINGUISHING_IPS = new Set(["unknown", "", "127.0.0.1", "::1", "::ffff:127.0.0.1", "0.0.0.0"]);

/**
 * True when `ip` can plausibly distinguish one visitor from another and is
 * therefore safe to use as a rate-limit bucket key. Callers should skip
 * IP-bucket enforcement entirely (not merely widen it) when this is false —
 * the per-email bucket already protects each individual account regardless.
 */
export function isDistinguishingClientIp(ip: string): boolean {
  return !NON_DISTINGUISHING_IPS.has(ip.trim().toLowerCase());
}

/**
 * FOUNDATION-P0-05.3 — basic per-bucket/per-subject sliding-window rate
 * limiter, backed by a Supabase table (auth_rate_limit_attempts) rather than
 * a new infrastructure dependency like Redis, per the backlog's explicit
 * "do not add a new infrastructure dependency without stopping to ask"
 * constraint. Sufficient for P0 blunting of credential-stuffing on
 * authentication endpoints; a distributed in-memory limiter would need a
 * shared store anyway on serverless, so the table-backed approach is also
 * the more correct one for this deployment target (Vercel).
 *
 * `subject` should be something meaningful to rate-limit per (e.g. an email
 * address, or a client IP) — callers typically check both, but should first
 * check `isDistinguishingClientIp()` before treating an IP as one.
 */
export async function checkAndRecordAttempt(
  bucket: string,
  subject: string,
  opts: { maxAttempts: number; windowSeconds: number },
): Promise<RateLimitResult> {
  const supabase = supabaseServiceRole();
  const windowStart = new Date(Date.now() - opts.windowSeconds * 1000).toISOString();

  // Best-effort cleanup of old attempts for this bucket+subject — keeps the
  // table small; not load-bearing for correctness (the windowed count query
  // below is what actually enforces the limit).
  await supabase
    .from("auth_rate_limit_attempts")
    .delete()
    .eq("bucket", bucket)
    .eq("subject", subject)
    .lt("attempted_at", windowStart);

  const { count } = await supabase
    .from("auth_rate_limit_attempts")
    .select("id", { count: "exact", head: true })
    .eq("bucket", bucket)
    .eq("subject", subject)
    .gte("attempted_at", windowStart);

  if ((count ?? 0) >= opts.maxAttempts) {
    return { allowed: false, retryAfterSeconds: opts.windowSeconds };
  }

  await supabase.from("auth_rate_limit_attempts").insert({ bucket, subject });
  return { allowed: true };
}
