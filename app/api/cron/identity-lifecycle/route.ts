import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { sweepEndDates } from "@/modules/agent-identity/service";

/**
 * IDENTITY-P0-18 (finish): the identity lifecycle's daily sweep, wired to
 * Vercel Cron via `vercel.json`, behind the same bearer secret as the other
 * cron routes. People whose end date has passed become leavers, which opens
 * their leaver work for people to do. Each write is filtered by the row's own
 * tenant.
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
  const endDates = await sweepEndDates(null);
  return NextResponse.json({ ok: true, data: { endDates } });
}
