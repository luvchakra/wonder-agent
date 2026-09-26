import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { sweepApprovalTimeouts } from "@/modules/access-governance/service";

/**
 * ACCESS-P0-19's scheduler: approval steps past their due time escalate to
 * access managers once, or expire the request, per each request's policy.
 * Wired to Vercel Cron via `vercel.json`; the same bearer-secret trust
 * boundary as `compliance-escalate-overdue/route.ts` (see its comment).
 * The sweep filters every write by each step's own tenant. Signed-in
 * approval views also sweep their own tenant, so a step never shows as
 * waiting on someone past its time.
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
  const result = await sweepApprovalTimeouts(null);
  return NextResponse.json({ ok: true, data: result });
}
