"use client";

import { useState } from "react";
import { getSupabasePublishableKey, getSupabaseUrl } from "@/lib/db/env";
import { supabaseBrowser } from "@/lib/db/supabaseBrowser";
import { Button } from "./Button";

/**
 * Social sign-in for /sign-in and /sign-up: Google, Microsoft and LinkedIn.
 * Both screens show the same controls — the provider decides whether the
 * account is new or returning, so there is no separate "sign up with X"
 * flow to build.
 *
 * Each button goes through Supabase Auth's own OAuth start
 * (`signInWithOAuth`), which redirects to the provider and, on return,
 * back to `/auth/callback` — the same route SSO and password recovery use,
 * where the PKCE code is exchanged for a session. The browser client is
 * used deliberately: `@supabase/ssr`'s `createBrowserClient` writes the
 * PKCE code verifier into a cookie the server callback can read, which is
 * what lets `exchangeCodeForSession()` complete server-side.
 *
 * Before redirecting, a button asks Supabase Auth's public settings whether
 * its provider is enabled. `signInWithOAuth` does not report "provider is
 * not enabled" itself: it navigates to `/auth/v1/authorize`, and a disabled
 * provider there returns a raw JSON 400 page. The check is the only way to
 * tell the user the truth on this screen (CLAUDE.md §17.5). It is a UX
 * guard, never an authorization decision: if the settings call fails, the
 * redirect proceeds and Supabase Auth remains the authority.
 *
 * Deliberately NOT rate-limited through `app/actions/auth.ts` like the
 * password paths are: no credential is presented here for us to throttle —
 * the provider authenticates, and Supabase Auth limits the callback.
 *
 * A social sign-in never grants membership of an organization by itself:
 * `/auth/callback` only provisions SSO-domain membership for users who
 * signed in through that organization's SSO (see `isSsoAuthenticated`).
 */

export type SocialProvider = "google" | "azure" | "linkedin_oidc";

type ProviderConfig = {
  /** Shown in labels and messages. */
  name: string;
  /**
   * Extra scopes. Microsoft (Supabase's `azure` provider) needs `email`
   * requested explicitly, or many accounts return no email address and
   * the sign-in cannot complete.
   */
  scopes?: string;
  Mark: () => React.JSX.Element;
};

export const SOCIAL_PROVIDERS: Record<SocialProvider, ProviderConfig> = {
  google: { name: "Google", Mark: GoogleMark },
  azure: { name: "Microsoft", scopes: "email", Mark: MicrosoftMark },
  linkedin_oidc: { name: "LinkedIn", Mark: LinkedInMark },
};

const PROVIDER_ORDER: SocialProvider[] = ["google", "azure", "linkedin_oidc"];

export function providerNotEnabledMessage(provider: SocialProvider): string {
  return `${SOCIAL_PROVIDERS[provider].name} sign-in is not enabled for WonderID yet. Use your email and password, or ask your administrator.`;
}

/** A slow answer must never leave a button stuck on "Redirecting…". */
const SETTINGS_TIMEOUT_MS = 3_000;

/**
 * Reads `external.<provider>` from Supabase Auth's public settings. Returns
 * `null` when the answer is unknown (network failure, timeout, unexpected
 * shape), so the caller falls through to Supabase rather than blocking on a
 * guess.
 */
export async function isOAuthProviderEnabled(
  provider: SocialProvider,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean | null> {
  try {
    const res = await fetchImpl(`${getSupabaseUrl()}/auth/v1/settings`, {
      headers: { apikey: getSupabasePublishableKey() },
      cache: "no-store",
      signal: AbortSignal.timeout(SETTINGS_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { external?: Record<string, unknown> };
    const enabled = body.external?.[provider];
    return typeof enabled === "boolean" ? enabled : null;
  } catch {
    return null;
  }
}

export function OAuthProviderButton({ provider, verb }: { provider: SocialProvider; verb: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { name, scopes, Mark } = SOCIAL_PROVIDERS[provider];
  const label = `${verb} with ${name}`;

  async function handleClick() {
    setPending(true);
    setError(null);
    if ((await isOAuthProviderEnabled(provider)) === false) {
      setError(providerNotEnabledMessage(provider));
      setPending(false);
      return;
    }
    const supabase = supabaseBrowser();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        ...(scopes ? { scopes } : {}),
      },
    });
    // On success the browser navigates to Supabase Auth, then the
    // provider, and nothing below runs. A failure here (e.g. the client
    // cannot build the PKCE request) is surfaced rather than swallowed.
    if (oauthError) {
      setError(oauthError.message);
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" onClick={handleClick} disabled={pending} className="w-full">
        <Mark />
        {pending ? "Redirecting…" : label}
      </Button>
      {error ? (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Google, Microsoft and LinkedIn, in that order. `verb` is "Sign in" or "Sign up". */
export function SocialAuthButtons({ verb }: { verb: "Sign in" | "Sign up" }) {
  return (
    <div className="space-y-2">
      {PROVIDER_ORDER.map((provider) => (
        <OAuthProviderButton key={provider} provider={provider} verb={verb} />
      ))}
    </div>
  );
}

/** Google's own four-colour mark, per their sign-in branding guidance. */
function GoogleMark() {
  return (
    <svg className="size-4" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2045c0-.6381-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2582h2.9087c1.7018-1.5668 2.6836-3.874 2.6836-6.6151z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.4673-.806 5.9564-2.1805l-2.9087-2.2582c-.8059.54-1.8368.859-3.0477.859-2.344 0-4.3282-1.5831-5.036-3.7104H.9574v2.3318C2.4382 15.9832 5.4818 18 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71c-.18-.54-.2822-1.1168-.2822-1.71s.1023-1.17.2823-1.71V4.9582H.9573A8.9965 8.9965 0 0 0 0 9c0 1.4523.3477 2.8268.9573 4.0418L3.964 10.71z"
      />
      <path
        fill="#EA4335"
        d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.346l2.5813-2.5814C13.4632.8918 11.426 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9582L3.964 7.29C4.6718 5.1627 6.6559 3.5795 9 3.5795z"
      />
    </svg>
  );
}

/** Microsoft's four-square logo, per its "Sign in with Microsoft" branding guidance. */
function MicrosoftMark() {
  return (
    <svg className="size-4" viewBox="0 0 21 21" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

/** LinkedIn's "in" bug in LinkedIn blue. */
function LinkedInMark() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect width="24" height="24" rx="4" fill="#0A66C2" />
      <path
        fill="#FFFFFF"
        d="M7.1 9.5H4.5V19h2.6V9.5zM5.8 5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM19.5 19h-2.6v-4.6c0-1.1 0-2.5-1.5-2.5-1.6 0-1.8 1.2-1.8 2.4V19H11V9.5h2.5v1.2c.4-.7 1.3-1.4 2.6-1.4 2.8 0 3.4 1.8 3.4 4.2V19z"
      />
    </svg>
  );
}
