import "server-only";

import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { actorAwareFetch } from "@/lib/security/actorHeader";
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
  // FOUNDATION-P0-31 — a call to /api/v1/* with an automation credential
  // acts as that credential's backing member: the client carries its
  // access token instead of cookies, so RLS and the authorization engine
  // apply exactly as for a person. The resolver verifies the credential
  // (hash, status, expiry, address, rate limit) and throws ApiError when
  // it may not be used. Imported lazily: it uses this module's service
  // role client.
  const { getAutomationAccess } = await import("@/lib/security/automationCredentials");
  const automation = await getAutomationAccess();
  if (automation) return supabaseWithAccessToken(automation.accessToken) as unknown as ReturnType<typeof cookieClient>;
  return cookieClient(await cookies());
});

function cookieClient(cookieStore: Awaited<ReturnType<typeof cookies>>) {
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
}

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
 *
 * Every request names the acting user in the `x-wonderid-actor` header
 * when one is signed in, so the database's record_provenance trigger
 * (migration 0115) can record who created or changed a row even though
 * the connection itself carries no session.
 */
export function supabaseServiceRole(options: { actor?: boolean } = {}) {
  return createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    // `actor: false` only for the automation credential lookup itself,
    // which runs while the actor is still being resolved.
    global: options.actor === false ? {} : { fetch: actorAwareFetch() },
  });
}

/** A client acting as the holder of `accessToken` (an automation credential's backing member; FOUNDATION-P0-31). */
export function supabaseWithAccessToken(accessToken: string) {
  return createClient(getSupabaseUrl(), getSupabasePublishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/** A client with no session, for a server-side password sign-in whose tokens stay in memory (FOUNDATION-P0-31). */
export function supabaseSignInClient() {
  return createClient(getSupabaseUrl(), getSupabasePublishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
