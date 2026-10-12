import { NextResponse, after } from "next/server";
import { receive } from "@/modules/integrations/framework/receive";
import { completeConnectorSignIn } from "@/modules/integrations/oauthCode";
import { OAUTH_COOKIE } from "@/modules/integrations/oauthCodeRules";

/**
 * The receiving side of the connector framework (non-negotiable #20): the
 * only route through which an organization's systems send WonderID data.
 *
 *   POST /api/connect/v1/<connection id>/events                 runtime events (connection secret)
 *   POST /api/connect/v1/<connection id>/webhook                any signed event (connection secret)
 *   POST /api/connect/v1/<connection id>/file                   a CSV file, x-wonderid-kind header (connection secret)
 *   POST /api/connect/v1/<connection id>/gateway/authorize      Runtime Gateway (agent API key)
 *   POST /api/connect/v1/<connection id>/gateway/tools/filter   Runtime Gateway (agent API key)
 *   GET  /api/connect/v1/<connection id>/oauth/callback         the provider's sign-in callback (signed state + cookie)
 *
 * No user session is read (proxy.ts skips /api/connect/). The body is read
 * as raw text so a signature is checked over the exact bytes sent. A
 * received file's sync runs after the response (after()).
 */
export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ connectionId: string; channel: string[] }> }) {
  const { connectionId, channel } = await params;
  const result = await receive(connectionId, channel.join("/"), await request.text(), request.headers);
  if (result.background) after(result.background);
  return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}

/**
 * INTEGRATION-P0-21: the provider sends an administrator's browser back
 * here after they approve the sign-in. The signed state and the cookie set
 * when they pressed Connect are checked before the code is used; the
 * browser always lands on the connection's page with the outcome.
 */
export async function GET(request: Request, { params }: { params: Promise<{ connectionId: string; channel: string[] }> }) {
  const { connectionId, channel } = await params;
  if (channel.join("/") !== "oauth/callback") return NextResponse.json({ ok: false, error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });
  const url = new URL(request.url);
  const cookie = request.headers.get("cookie")?.split(/;\s*/).find((c) => c.startsWith(`${OAUTH_COOKIE}=`));
  const value = cookie ? decodeURIComponent(cookie.slice(OAUTH_COOKIE.length + 1)) : null;
  const { location, cookiePath } = await completeConnectorSignIn(connectionId, url.searchParams, value);
  const res = NextResponse.redirect(new URL(location, url), 303);
  res.cookies.set(OAUTH_COOKIE, "", { httpOnly: true, sameSite: "lax", path: cookiePath, maxAge: 0 });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
