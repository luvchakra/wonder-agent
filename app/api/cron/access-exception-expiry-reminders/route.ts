import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { sendExpiredExceptionRemindersForAllTenants } from "@/modules/access-governance/service";

/**
 * OPERATIONS-P0-02.2's `lifecycle_expiry` scheduler (2026-09-19), wired to
 * Vercel Cron via `vercel.json`. Same shape as `compliance-escalate-
 * overdue/route.ts` (COMPLIANCE-P0-05) — see that route's own doc comment
 * for the full reasoning on the bearer-secret trust boundary and why this
 * sits outside `/api/v1/*`/`/api/platform/v1/*`.
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

  const results = await sendExpiredExceptionRemindersForAllTenants();
  const totalNotified = results.reduce((sum, r) => sum + r.notifiedCount, 0);
  const failedTenants = results.filter((r) => r.error);

  return NextResponse.json({
    ok: true,
    data: { totalNotified, tenantsSwept: results.length, failedTenants },
  });
}
