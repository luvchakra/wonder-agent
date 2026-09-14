import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublishableKey, getSupabaseUrl } from "@/lib/db/env";
import {
  SESSION_LAST_SEEN_COOKIE,
  SESSION_STARTED_COOKIE,
  checkSessionExpiry,
} from "@/lib/tenant/sessionSecurity";
import { TENANT_COOKIE_NAME } from "@/lib/tenant/getTenantContext";

const UNENFORCED_PATHS = ["/sign-in", "/sign-up", "/auth/callback"];

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

  const supabase = createServerClient(getSupabaseUrl(), getSupabasePublishableKey(), {
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

  // Touch the session so @supabase/ssr can refresh expired tokens.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user && !UNENFORCED_PATHS.some((p) => request.nextUrl.pathname.startsWith(p))) {
    const startedAt = request.cookies.get(SESSION_STARTED_COOKIE)?.value;
    const lastSeen = request.cookies.get(SESSION_LAST_SEEN_COOKIE)?.value;
    const { expired } = checkSessionExpiry(
      startedAt ? Number(startedAt) : null,
      lastSeen ? Number(lastSeen) : null,
    );

    if (expired) {
      await supabase.auth.signOut();
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
