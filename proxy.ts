import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getOptionalSupabasePublishableKey, getOptionalSupabaseUrl } from "@/lib/db/env";
import {
  SESSION_LAST_SEEN_COOKIE,
  SESSION_STARTED_COOKIE,
  checkSessionExpiry,
} from "@/lib/tenant/sessionSecurity";
import { TENANT_COOKIE_NAME } from "@/lib/tenant/getTenantContext";

/**
 * Reachable without a session. Everything else under the matcher needs one.
 * /forgot-password and /update-password join this list alongside
 * /sign-in/up: a visitor resetting a password is by definition
 * unauthenticated when they land on /forgot-password, and /update-password
 * shows its own "Link expired" state for a missing/expired/already-used
 * recovery session (app/update-password/page.tsx) — that UX only ever runs
 * if the proxy lets the unauthenticated request through to it instead of
 * redirecting to /sign-in first.
 */
const PUBLIC_PATHS = ["/sign-in", "/sign-up", "/auth/", "/welcome", "/forgot-password", "/update-password"];
/** Paths the idle/absolute session-expiry clock does not run on. */
const UNENFORCED_PATHS = ["/sign-in", "/sign-up", "/auth/callback", "/welcome", "/forgot-password", "/update-password"];

/**
 * Refreshes the Supabase session cookie on every request (required by
 * @supabase/ssr), acts as a defense-in-depth check for the platform-admin
 * authorization boundary (CLAUDE.md non-negotiable #3 — the per-route
 * requirePlatformAdmin() check is the actual enforcement, this is
 * additional), and enforces idle/absolute session expiry
 * (FOUNDATION-P0-09) on top of Supabase Auth's own JWT expiry/refresh.
 */
export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request });
  const { pathname } = request.nextUrl;

  // The proxy runs ahead of EVERY route, so anything it throws becomes a
  // 500 on every URL in the deployment — including /welcome, which is a
  // static marketing page that touches no database. Read the two public
  // Supabase variables without throwing and, when the deployment has not
  // been given them, skip the session work entirely: there can be no
  // session to read or refresh, so every visitor is signed out and the
  // landing page is what "/" should serve. Routes that genuinely need the
  // database still fail loudly, in their own handlers, via the throwing
  // getters in lib/db/env.ts — this makes a misconfigured deployment
  // legible instead of uniformly broken, it does not paper over one.
  const supabaseUrl = getOptionalSupabaseUrl();
  const supabaseKey = getOptionalSupabasePublishableKey();
  if (!supabaseUrl || !supabaseKey) {
    if (pathname === "/") {
      return NextResponse.rewrite(new URL("/welcome", request.url), { request });
    }
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // This is the ONE place per request that asks the auth server whether
  // the session is still good. Everything rendered after it — the layout,
  // the page, the module services — verifies the token locally instead
  // (lib/tenant/session.ts), so a page costs one GoTrue round trip rather
  // than the four or five it used to.
  //
  // It has to be a real round trip and not a signature check, because of
  // a product decision (user, 2026-09-17): logging out is global and takes
  // effect immediately in every other session. A revoked session's access
  // token still has a valid signature until it expires; only the auth
  // server knows it was revoked. getUser() also lets @supabase/ssr rotate
  // an expired token's cookies here, before the route runs.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Enforcement moved here from the customer layout so a session the auth
  // server has rejected never reaches a route whose local check would
  // still pass. "Presented a session cookie but the server rejected it"
  // is distinguished from "no session at all": the former is refused on
  // every path, the latter is refused on protected pages and passed
  // through on the API, whose routes without a session (the cron job, the
  // integration webhooks, the MCP ingest, the SSO domain lookup) hold
  // their own credentials and gate themselves.
  if (!user) {
    const presentedSession = request.cookies
      .getAll()
      .some((c) => c.name.startsWith("sb-") && c.name.includes("-auth-token"));
    const isApi = pathname.startsWith("/api/");
    const isPublicPage = pathname === "/" || PUBLIC_PATHS.some((p) => pathname.startsWith(p));

    if (isApi && presentedSession) {
      return NextResponse.json(
        { ok: false, error: { code: "UNAUTHENTICATED", message: "Session is no longer valid" } },
        { status: 401 },
      );
    }
    if (!isApi && !isPublicPage) {
      const signIn = new URL("/sign-in", request.url);
      if (presentedSession) signIn.searchParams.set("reason", "expired");
      return NextResponse.redirect(signIn);
    }
  }

  // EXPERIENCE-P0-14 — the public landing page lives at /welcome but is
  // SERVED at "/" for signed-out visitors. A rewrite (not a redirect) keeps
  // the URL at "/" while rendering the marketing tree, which lets the
  // landing page and the authenticated Overview share the root path without
  // two route groups both declaring a `page.tsx` for it.
  if (!user && pathname === "/") {
    return NextResponse.rewrite(new URL("/welcome", request.url), { request });
  }
  // A signed-in user has no use for the marketing page; send them to the app.
  if (user && pathname === "/welcome") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (user && !UNENFORCED_PATHS.some((p) => request.nextUrl.pathname.startsWith(p))) {
    const startedAt = request.cookies.get(SESSION_STARTED_COOKIE)?.value;
    const lastSeen = request.cookies.get(SESSION_LAST_SEEN_COOKIE)?.value;
    const { expired } = checkSessionExpiry(
      startedAt ? Number(startedAt) : null,
      lastSeen ? Number(lastSeen) : null,
    );

    if (expired) {
      // Same global scope as signOutAction(), stated explicitly so the two
      // sign-out paths cannot drift apart on a supabase-js upgrade. Note
      // this is the IDLE/ABSOLUTE-EXPIRY path, not a user-initiated logout:
      // it means timing out on one device also ends the user's sessions
      // elsewhere. That is the current behaviour (it was always the
      // library default) and is consistent with the product's global
      // posture, but it was not separately decided — flagged here rather
      // than changed.
      await supabase.auth.signOut({ scope: "global" });
      const redirectResponse = NextResponse.redirect(new URL("/sign-in?reason=expired", request.url));
      redirectResponse.cookies.delete(SESSION_STARTED_COOKIE);
      redirectResponse.cookies.delete(SESSION_LAST_SEEN_COOKIE);
      redirectResponse.cookies.delete(TENANT_COOKIE_NAME);
      return redirectResponse;
    }

    response.cookies.set(SESSION_LAST_SEEN_COOKIE, Date.now().toString(), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
    if (!startedAt) {
      // A session established before this story shipped (or the SSO
      // callback path, which stamps its own cookies) — backfill so the
      // absolute-timeout clock starts now rather than never triggering.
      response.cookies.set(SESSION_STARTED_COOKIE, Date.now().toString(), {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
      });
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
