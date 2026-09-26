import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getOptionalSupabasePublishableKey, getOptionalSupabaseUrl } from "@/lib/db/env";
import {
  SESSION_LAST_SEEN_COOKIE,
  SESSION_STARTED_COOKIE,
  checkSessionExpiry,
  isAuthServiceUnavailable,
} from "@/lib/tenant/sessionSecurity";
import { TENANT_COOKIE_NAME } from "@/lib/tenant/getTenantContext";
import { baseAppHost, parseTenantHost } from "@/lib/tenant/host";

/**
 * Reachable without a session. Everything else under the matcher needs one.
 * /forgot-password and /update-password join this list alongside
 * /sign-in/up: a visitor resetting a password is by definition
 * unauthenticated when they land on /forgot-password, and /update-password
 * shows its own "Link expired" state for a missing/expired/already-used
 * recovery session (app/update-password/page.tsx) — that UX only ever runs
 * if the proxy lets the unauthenticated request through to it instead of
 * redirecting to /sign-in first.
 *
 * /help is public too (2026-09-18): the user guide and FAQ are product
 * documentation, identical for every visitor and containing no customer
 * data, so there is no reason to gate them behind a session — see
 * app/help/layout.tsx.
 */
const PUBLIC_PATHS = ["/sign-in", "/sign-up", "/auth/", "/welcome", "/forgot-password", "/update-password", "/help", "/service-unavailable", "/tenant-not-found"];
/** Paths the idle/absolute session-expiry clock does not run on. */
const UNENFORCED_PATHS = [
  "/sign-in",
  "/sign-up",
  "/auth/callback",
  "/welcome",
  "/forgot-password",
  "/update-password",
  "/help",
];

/**
 * Refreshes the Supabase session cookie on every request (required by
 * @supabase/ssr), acts as a defense-in-depth check for the platform-admin
 * authorization boundary (CLAUDE.md non-negotiable #3 — the per-route
 * requirePlatformAdmin() check is the actual enforcement, this is
 * additional), and enforces idle/absolute session expiry
 * (FOUNDATION-P0-09) on top of Supabase Auth's own JWT expiry/refresh.
 */
// FOUNDATION-P0-22 — which tenant addresses exist, per host label, for a
// short time. Bounded (oldest entries dropped) and keyed by the address
// alone: it holds only "is there a tenant here", never tenant data.
const HOST_CACHE_TTL_MS = 30_000;
const HOST_CACHE_MAX = 500;
const hostCache = new Map<string, { found: boolean; at: number }>();

async function lookUpTenantHost(supabase: ReturnType<typeof createServerClient>, label: string): Promise<"found" | "missing" | "error"> {
  const hit = hostCache.get(label);
  if (hit && Date.now() - hit.at < HOST_CACHE_TTL_MS) return hit.found ? "found" : "missing";
  const { data, error } = await supabase.rpc("resolve_tenant_host", { p_subdomain: label, p_hostname: null });
  if (error) return "error";
  const found = Array.isArray(data) ? data.length > 0 : Boolean(data);
  if (hostCache.size >= HOST_CACHE_MAX) hostCache.delete(hostCache.keys().next().value as string);
  hostCache.set(label, { found, at: Date.now() });
  return found ? "found" : "missing";
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // RUNTIME-P0-15 — the Runtime Gateway is a separate boundary: agents
  // authenticate every call with their own API key inside the route, and
  // master stories §25 require the runtime path not to depend on dashboard
  // request handling. So it skips the session refresh and its GoTrue round
  // trip entirely; no cookie is read or written for it.
  if (pathname.startsWith("/api/gateway/")) {
    return NextResponse.next();
  }

  const response = NextResponse.next({ request });

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
  //
  // FOUNDATION-P0-22 — on a tenant address (`<slug>.<BASE_APP_HOST>`), the
  // tenant it names is looked up alongside the session check (in parallel,
  // cached briefly per host). An address that names no tenant is a 404 on
  // every path; a failed lookup fails closed as "unavailable". The address
  // never authorizes anything: that is still the membership check.
  const hostTarget = parseTenantHost(request.headers.get("host"), baseAppHost());
  const [
    {
      data: { user },
      error: authError,
    },
    hostLookup,
  ] = await Promise.all([supabase.auth.getUser(), hostTarget.kind === "subdomain" ? lookUpTenantHost(supabase, hostTarget.label) : Promise.resolve(null)]);

  if (hostTarget.kind === "invalid" || (hostTarget.kind === "subdomain" && hostLookup !== "found")) {
    const unavailable = hostLookup === "error";
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        unavailable
          ? { ok: false, error: { code: "TENANT_LOOKUP_UNAVAILABLE", message: "The organization could not be looked up; try again shortly" } }
          : { ok: false, error: { code: "TENANT_NOT_FOUND", message: "No organization is at this address" } },
        { status: unavailable ? 503 : 404 },
      );
    }
    if (!pathname.startsWith("/tenant-not-found") && !pathname.startsWith("/service-unavailable")) {
      return NextResponse.rewrite(new URL(unavailable ? "/service-unavailable" : "/tenant-not-found", request.url), { status: unavailable ? 503 : 404 });
    }
  }

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

    // The auth server could not be reached: still no access (fail closed),
    // but say so truthfully rather than "your session expired" (§17.5).
    if (presentedSession && isAuthServiceUnavailable(authError) && !isPublicPage) {
      if (isApi) {
        return NextResponse.json(
          { ok: false, error: { code: "AUTH_UNAVAILABLE", message: "The sign-in service is unavailable; try again shortly" } },
          { status: 503, headers: { "Retry-After": "30" } },
        );
      }
      return NextResponse.rewrite(new URL("/service-unavailable", request.url), { status: 503, headers: { "Retry-After": "30" } });
    }

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
  // FOUNDATION-P0-22 — an organization's own address opens its sign-in
  // page, never the marketing page (spec §28: no picker, no detour).
  const onTenantAddress = hostTarget.kind === "subdomain";
  if (!user && onTenantAddress && (pathname === "/" || pathname.startsWith("/welcome") || pathname.startsWith("/sign-up"))) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }
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

// Public static files skip the proxy: the build's assets, the site icons
// and the brand artwork (public/brand/), which the sign-in page shows
// before anyone has a session. None of it is tenant data.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|brand/).*)"],
};
