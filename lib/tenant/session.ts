import "server-only";

import { cache } from "react";
import { supabaseServer } from "@/lib/db/supabaseServer";

export type SessionUser = {
  id: string;
  email: string | null;
  /** The session's authenticator assurance level (aal2 after MFA), from the verified token (FOUNDATION-P0-19). */
  aal: "aal1" | "aal2" | null;
};

/**
 * The authenticated user for the current request, resolved once and shared
 * by everything rendered in it.
 *
 * Why `getClaims()` and not `getUser()`: `getUser()` is a network round
 * trip to GoTrue on every call, and this app was making it four or five
 * times per page (proxy, layout, tenant context, platform-admin check,
 * then the page again). `getClaims()` verifies the access token's ES256
 * signature locally against the project's JWKS — which auth-js caches
 * globally across client instances — so after the first request it costs
 * about a millisecond.
 *
 * This is safe only because proxy.ts has ALREADY asked the auth server
 * about this exact session before the route ran, and turned it away if
 * the server rejected it (a revoked session's token still has a valid
 * signature until it expires — logout is global and immediate by product
 * decision, so that check must be a real round trip, once). Here we only
 * re-derive identity from a token the proxy just validated. Do not use
 * this from anything that does not sit behind the proxy.
 *
 * `cache()` scopes the result to the request: the layout, the page, and
 * every service they call see the same value with one verification.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  const email = typeof data.claims.email === "string" ? data.claims.email : null;
  const aal = data.claims.aal === "aal2" ? "aal2" : data.claims.aal === "aal1" ? "aal1" : null;
  return { id: data.claims.sub, email, aal };
});

/**
 * The signed-in user's profile row, once per request. The shell shows the
 * display name in the account block and the dashboard greets by it; they
 * used to issue the same query independently.
 */
export const getProfile = cache(async (): Promise<{ displayName: string | null } | null> => {
  const user = await getSessionUser();
  if (!user) return null;
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("users")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle<{ display_name: string | null }>();
  return { displayName: data?.display_name ?? null };
});
