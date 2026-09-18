import "server-only";

import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import {
  getSupabasePublishableKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
} from "./env";

/**
 * Request-scoped Supabase client that forwards the current user's session via
 * cookies, so PostgreSQL RLS applies exactly as that authenticated user.
 * This is what almost all server code / API routes should use.
 *
 * Wrapped in React's `cache()` so a request builds one client and every
 * caller in it — the layout, the page, each module service they call —
 * shares it. The client itself is cheap to construct; what matters is that
 * its auth state (the verified session, a refreshed token) is resolved once
 * per request instead of once per caller.
 */
export const supabaseServer = cache(async () => {
  const cookieStore = await cookies();

  return createServerClient(getSupabaseUrl(), getSupabasePublishableKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component with no response to write to;
          // safe to ignore as long as middleware refreshes the session.
        }
      },
    },
  });
});

/**
 * Trusted, service-role Supabase client. Bypasses RLS entirely.
 *
 * Usable ONLY from trusted server contexts: the audit writer, migrations
 * tooling, background jobs, and equivalent infrastructure code. Never call
 * this to serve a user-facing read/write on their behalf — use
 * `supabaseServer()` for that so RLS stays the enforcement layer.
 *
 * The `server-only` import above already prevents this module from being
 * bundled into client code; `getSupabaseServiceRoleKey()` adds a second,
 * independent runtime guard.
 */
export function supabaseServiceRole() {
  return createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
