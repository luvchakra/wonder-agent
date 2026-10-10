import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runPrivacyJobs } from "@/modules/privacy/service";
import { purgeConnectorTraffic } from "@/modules/integrations/service";

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
  // The same daily retention run also ages out the Connector Gateway's traffic ledger (30 days, migration 0110).
  // A failed purge reports null and is retried by the next run; it never fails the privacy job.
  const [result, connectorTrafficPurged] = await Promise.all([
    runPrivacyJobs(),
    purgeConnectorTraffic().catch(() => {
      console.error("cron: connector traffic purge failed");
      return null;
    }),
  ]);
  return NextResponse.json({ ok: true, data: { tenants: result.tenants, connectorTrafficPurged } });
}
