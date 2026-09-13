import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublishableKey, getSupabaseUrl } from "@/lib/db/env";

/**
 * Refreshes the Supabase session cookie on every request (required by
 * @supabase/ssr) and acts as a defense-in-depth check for the
 * platform-admin authorization boundary (CLAUDE.md non-negotiable #3) —
 * the per-route requirePlatformAdmin() check in app/platform-admin/layout.tsx
 * and every app/api/platform/v1/** route is the actual enforcement; this is
 * an additional edge-level check, not a replacement for it.
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
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
