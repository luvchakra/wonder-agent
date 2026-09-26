import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { sweepApprovalTimeouts, sweepPackageExpiry } from "@/modules/access-governance/service";

/**
 * Access governance's daily sweep, wired to Vercel Cron via `vercel.json`;
 * the same bearer-secret trust boundary as
 * `compliance-escalate-overdue/route.ts` (see its comment):
 * - ACCESS-P0-19: approval steps past their due time escalate to access
 *   managers once, or expire the request, per each request's policy;
 * - ACCESS-P0-20: package assignments past their end expire, and what they
 *   granted becomes revocation work.
 * Each sweep filters every write by the row's own tenant. Signed-in views
 * also sweep their own tenant, so nothing shows as current past its time.
 */
function isAuthorized(request: NextRequest): boolean {
  const configuredSecret = process.env.CRON_SECRET;
  if (!configuredSecret) return false;
  const expectedBuf = Buffer.from(`Bearer ${configuredSecret}`);
  const actualBuf = Buffer.from(request.headers.get("authorization") ?? "");
  if (actualBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(actualBuf, expectedBuf);
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: { code: "UNAUTHORIZED" } }, { status: 401 });
  }
  const [approvals, packages] = await Promise.all([sweepApprovalTimeouts(null), sweepPackageExpiry(null)]);
  return NextResponse.json({ ok: true, data: { approvals, packages } });
}
