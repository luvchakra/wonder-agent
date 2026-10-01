import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runPrivacyJobs } from "@/modules/privacy/service";

/**
 * COMPLIANCE-P0-12 — the daily privacy job, wired to Vercel Cron in
 * vercel.json, behind the same bearer-secret boundary as the other cron
 * routes: applies each tenant's retention policies (legal holds honoured;
 * the audit trail only through the hash-chain purge) and reminds privacy
 * staff of request deadlines and outstanding breach notifications. Every
 * write is filtered by that tenant.
 */
function isAuthorized(request: NextRequest): boolean {
  const configuredSecret = process.env.CRON_SECRET;
  if (!configuredSecret) return false;
  const expectedBuf = Buffer.from(`Bearer ${configuredSecret}`);
  const actualBuf = Buffer.from(request.headers.get("authorization") ?? "");
  if (actualBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(actualBuf, expectedBuf);
}

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: { code: "UNAUTHORIZED" } }, { status: 401 });
  }
  const result = await runPrivacyJobs();
  return NextResponse.json({ ok: true, data: { tenants: result.tenants } });
}
