import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runScheduledSyncs } from "@/modules/integrations/service";

/**
 * Scheduled connector syncs, wired to Vercel Cron in vercel.json (daily on
 * this plan), behind the same bearer-secret boundary as the other cron
 * routes. Runs every connection whose schedule is due, each as an ordinary
 * sync job for its own tenant (idempotent per connection and window), then
 * purges received files that are read and no longer among a connection's
 * newest five. An hourly schedule runs at each cron run until the cron runs
 * more often (modules/integrations/connectorScheduleRules.ts).
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
  const summary = await runScheduledSyncs(new Date(), { budgetMs: 240_000 });
  return NextResponse.json({ ok: true, data: summary });
}
