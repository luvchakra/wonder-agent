import { getSupabasePublishableKey, getSupabaseUrl } from "@/lib/db/env";

/**
 * Which sign-in methods Supabase Auth has turned on, from its public
 * settings (`/auth/v1/settings`). Used by the sign-in and sign-up screens to
 * show a method that is not set up as disabled rather than letting a click
 * end on an error (owner request, 2026-10-10). A UX guard only: Supabase
 * Auth stays the authority on every sign-in.
 *
 * Not a client module, so the server-rendered sign-in page and the client
 * buttons share it.
 */
export type AuthProviderStatus = { google: boolean; azure: boolean; linkedin_oidc: boolean; sso: boolean };

/** null when the answer is not the expected shape: the caller then leaves every method on. */
export function parseAuthSettings(body: unknown): AuthProviderStatus | null {
  if (!body || typeof body !== "object") return null;
  const external = (body as { external?: unknown }).external;
  if (!external || typeof external !== "object") return null;
  const flag = (v: unknown) => v === true;
  const e = external as Record<string, unknown>;
  return {
    google: flag(e.google),
    azure: flag(e.azure),
    linkedin_oidc: flag(e.linkedin_oidc),
    sso: flag((body as { saml_enabled?: unknown }).saml_enabled),
  };
}

const TIMEOUT_MS = 3_000;

/** Fetches the status; null on any failure, so an unknown answer never disables a working method. */
export async function fetchAuthProviderStatus(
  fetchImpl: typeof fetch = fetch,
  init: RequestInit & { next?: { revalidate: number } } = { cache: "no-store" },
): Promise<AuthProviderStatus | null> {
  try {
    const res = await fetchImpl(`${getSupabaseUrl()}/auth/v1/settings`, {
      ...init,
      headers: { apikey: getSupabasePublishableKey() },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return parseAuthSettings(await res.json());
  } catch {
    return null;
  }
}
