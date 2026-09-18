"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/db/supabaseBrowser";
import { Button } from "./Button";

/**
 * Google OAuth entry point for /sign-in and /sign-up. Both screens show the
 * same control — Google itself decides whether the account is new or
 * returning, so there is no separate "sign up with Google" flow to build.
 *
 * Routed through Supabase Auth's own OAuth start (`signInWithOAuth`), which
 * redirects the browser to Google and, on return, back to
 * `/auth/callback` — the same route SSO and password-recovery already use,
 * where the PKCE code is exchanged for a session. The browser client is
 * used deliberately: `@supabase/ssr`'s `createBrowserClient` writes the
 * PKCE code verifier into a cookie the server callback can read, which is
 * what lets `exchangeCodeForSession()` complete server-side.
 *
 * Deliberately NOT rate-limited through `app/actions/auth.ts` like the
 * password paths are: no credential is presented here for us to throttle —
 * Google performs the authentication, and Supabase Auth applies its own
 * limits to the callback.
 */
export function GoogleAuthButton({ label = "Continue with Google" }: { label?: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setPending(true);
    setError(null);
    const supabase = supabaseBrowser();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    // On success the browser navigates to Google and nothing below runs.
    // A failure here is almost always "provider is not enabled" on the
    // Supabase project — surfaced rather than swallowed, so a
    // misconfigured deployment is legible instead of a dead button.
    if (oauthError) {
      setError(oauthError.message);
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" onClick={handleClick} disabled={pending} className="w-full">
        <GoogleMark />
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
