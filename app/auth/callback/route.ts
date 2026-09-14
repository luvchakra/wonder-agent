import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/db/supabaseServer";
import { getFullActiveSsoConnectionByDomain, provisionSsoMembership } from "@/lib/auth/sso";
import { TENANT_COOKIE_NAME } from "@/lib/tenant/getTenantContext";
import { SESSION_LAST_SEEN_COOKIE, SESSION_STARTED_COOKIE } from "@/lib/tenant/sessionSecurity";

/**
 * FOUNDATION-P0-03.3 — completes an SSO (or any Supabase Auth PKCE) redirect
 * and performs SSO just-in-time tenant provisioning.
 *
 * Verified in this environment: the code-exchange → session → JIT-membership
 * logic below, using synthetic claims (see the unit tests in
 * lib/auth/sso.test.ts). NOT verified: an actual end-to-end SAML/OIDC
 * redirect against a real IdP — that requires a real identity provider and a
 * Supabase-project-level SSO configuration (an Enterprise/Pro-tier,
 * dashboard/CLI-level setup step, not application code) that does not exist
 * on this environment's connected project. Flagged per the backlog's own
 * stop-and-report allowance rather than fabricated/claimed as tested.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const supabase = await supabaseServer();

  if (code) {
    await supabase.auth.exchangeCodeForSession(code);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  const domain = user.email.split("@")[1]?.toLowerCase();
  const cookieStore = await cookies();

  // FOUNDATION-P0-09 — stamp session-start/last-seen cookies for this new
  // session regardless of which branch below is taken.
  const sessionCookieOpts = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
  const nowStamp = Date.now().toString();
  cookieStore.set(SESSION_STARTED_COOKIE, nowStamp, sessionCookieOpts);
  cookieStore.set(SESSION_LAST_SEEN_COOKIE, nowStamp, sessionCookieOpts);

  if (domain) {
    const connection = await getFullActiveSsoConnectionByDomain(domain);
    if (connection) {
      // IdP-asserted attributes land in user_metadata for OIDC and in the
      // linked identity's identity_data for SAML/OIDC alike, depending on
      // provider — merge both so resolveJitRole can find a configured
      // role/group claim key regardless of which shape the real IdP used.
      const identityData = user.identities?.[0]?.identity_data ?? {};
      const claims = { ...identityData, ...user.user_metadata };

      await provisionSsoMembership(user.id, connection, claims);
      cookieStore.set(TENANT_COOKIE_NAME, connection.tenantId, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
      });
      return NextResponse.redirect(new URL("/", request.url));
    }
  }

  // Not an SSO-provisioned domain (or no match) — fall back to the ordinary
  // membership-selection/creation flow.
  return NextResponse.redirect(new URL("/onboarding", request.url));
}
