import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { escalateOverdueItemsForAllTenants } from "@/modules/certification-compliance/service";

/**
 * COMPLIANCE-P0-05's scheduler. Wired to Vercel Cron via `vercel.json`
 * (`"path": "/api/cron/compliance-escalate-overdue"`), which sends
 * `Authorization: Bearer $CRON_SECRET` on every scheduled invocation —
 * https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs.
 * This route has no user session (no tenant to resolve from a JWT), so it
 * is intentionally outside `/api/v1/*` (customer-facing, tenant-context-
 * resolved) and `/api/platform/v1/*` (vendor-admin-session-resolved) — the
 * bearer secret is its only trust boundary, checked with a constant-time
 * comparison (same reasoning as Integration Agent's webhook HMAC check in
 * `modules/integrations/webhooks.ts`, just a plain shared secret here
 * rather than a signature over a body).
 *
 * CRON_SECRET unset is refused (500), not silently allowed through — a
 * missing secret must never make this endpoint an unauthenticated way to
 * force-escalate every tenant's overdue items.
 */
function isAuthorized(request: NextRequest): boolean {
  const configuredSecret = process.env.CRON_SECRET;
  if (!configuredSecret) return false;

  const authHeader = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${configuredSecret}`;
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(authHeader);
  if (actualBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(actualBuf, expectedBuf);
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: { code: "UNAUTHORIZED" } }, { status: 401 });
  }

  const results = await escalateOverdueItemsForAllTenants();
  const totalEscalated = results.reduce((sum, r) => sum + r.escalatedCount, 0);
  const failedTenants = results.filter((r) => r.error);

  return NextResponse.json({
    ok: true,
    data: { totalEscalated, tenantsSwept: results.length, failedTenants },
  });
}
