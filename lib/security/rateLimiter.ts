import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";

export type RateLimitResult = { allowed: boolean; retryAfterSeconds?: number };

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
 * address, or a client IP) — callers typically check both.
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
