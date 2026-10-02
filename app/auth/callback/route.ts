import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/db/supabaseServer";
import { getFullActiveSsoConnectionByDomain, provisionSsoMembership } from "@/lib/auth/sso";
import { TENANT_COOKIE_NAME, getTenantContext } from "@/lib/tenant/getTenantContext";
import { SESSION_LAST_SEEN_COOKIE, SESSION_STARTED_COOKIE } from "@/lib/tenant/sessionSecurity";

/**
 * True only for a same-origin relative path — rejects a protocol-relative
 * URL ("//evil.example.com") and anything else that isn't a bare "/..."
 * path, so `next` can never turn this callback into an open redirect.
 * Exported (rather than kept private) so it has direct unit-test coverage
 * without needing a Next.js request/response round trip.
 */
export function isSafeRelativeNextPath(next: string | null): next is string {
  return !!next && next.startsWith("/") && !next.startsWith("//");
}

/**
 * Why a sign-in that reached this callback without producing a session
 * failed, as a fixed code for /sign-in's `reason` parameter. The provider's
 * own `error_description` is deliberately never forwarded: it is external
 * text, and reflecting it onto the sign-in page would let anyone craft a
 * link that displays arbitrary wording there (CLAUDE.md §17.2).
 * `access_denied` is what Google (and the OAuth spec) return when the user
 * cancels on the consent screen.
 */
export function signInFailureReason(providerError: string | null, exchangeFailed: boolean): string | null {
  if (providerError === "access_denied") return "oauth_cancelled";
  if (providerError || exchangeFailed) return "oauth_failed";
  return null;
}

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
  const providerError = request.nextUrl.searchParams.get("error");
  const supabase = await supabaseServer();

  let exchangeFailed = false;
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    exchangeFailed = !!error;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    // A failed or cancelled Google/SSO round trip lands here with no
    // session; say so on /sign-in rather than silently showing the form.
    const signIn = new URL("/sign-in", request.url);
    const reason = signInFailureReason(providerError, exchangeFailed);
    if (reason) signIn.searchParams.set("reason", reason);
    return NextResponse.redirect(signIn);
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

  // Forgot-password (requestPasswordResetAction in app/actions/auth.ts)
  // routes its emailed link through this same callback with
  // ?next=/update-password rather than a dedicated callback route, so the
  // recovery code-exchange above reuses this route's session-cookie
  // stamping.
  const next = request.nextUrl.searchParams.get("next");
  if (isSafeRelativeNextPath(next)) {
    return NextResponse.redirect(new URL(next, request.url));
  }

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

  // Not an SSO-provisioned domain (or no match). A user who already has a
  // tenant goes straight to the app — /onboarding deliberately does NOT
  // auto-forward someone with memberships (it doubles as the "create
  // another organization" screen), so sending everyone there would make
  // every returning Google/email user pick their organization on each
  // sign-in. That is the same friction FOUNDATION already removed from the
  // password path ("sign-in lands on the app, not the organization
  // picker"); this brings the OAuth/callback path in line with it. Only a
  // genuinely new user with no membership yet still needs /onboarding.
  const ctx = await getTenantContext();
  return NextResponse.redirect(new URL(ctx.tenantId ? "/" : "/onboarding", request.url));
}
