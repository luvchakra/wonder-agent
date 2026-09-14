"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/db/supabaseBrowser";
import { signInAction } from "@/app/actions/auth";

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionExpired = searchParams.get("reason") === "expired";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [ssoChecking, setSsoChecking] = useState(false);

  // FOUNDATION-P0-05.3 — routed through a server action (rather than
  // calling supabase.auth.signInWithPassword directly from the browser) so
  // a per-email/per-IP rate limit can be enforced server-side before any
  // credential is checked.
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const result = await signInAction(email, password);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.push("/onboarding");
    router.refresh();
  }

  // FOUNDATION-P0-03.3 — domain-based SSO routing. Looks up whether the
  // typed email's domain has an active SSO connection; if so, hands off to
  // Supabase Auth's own SSO flow rather than the password form. Never
  // trusts the domain for authorization by itself — it only picks which
  // sign-in flow to start (CLAUDE.md non-negotiable #2).
  async function handleSsoSignIn() {
    const domain = email.split("@")[1]?.trim().toLowerCase();
    if (!domain) {
      setError("Enter your work email above first, then choose Sign in with SSO.");
      return;
    }
    setSsoChecking(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/sso/domain-lookup?domain=${encodeURIComponent(domain)}`);
      const body = await res.json();
      if (!body.ok || !body.data) {
        setError(`No SSO connection configured for ${domain}.`);
        return;
      }
      const supabase = supabaseBrowser();
      const { error } = await supabase.auth.signInWithSSO({ domain });
      if (error) setError(error.message);
    } finally {
      setSsoChecking(false);
    }
  }

  return (
    <main style={{ maxWidth: 360, margin: "4rem auto", fontFamily: "sans-serif" }}>
      <h1>Sign in to WonderAgent</h1>
      <form onSubmit={handleSubmit}>
        <label>
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ display: "block", width: "100%", marginBottom: 12 }}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ display: "block", width: "100%", marginBottom: 12 }}
          />
        </label>
        {sessionExpired && !error ? (
          <p style={{ color: "#946200" }}>Your session expired. Please sign in again.</p>
        ) : null}
        {error ? <p style={{ color: "crimson" }}>{error}</p> : null}
        <button type="submit" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <button type="button" onClick={handleSsoSignIn} disabled={ssoChecking} style={{ marginTop: 8 }}>
        {ssoChecking ? "Checking…" : "Sign in with SSO"}
      </button>
      <p>
        Need an account? <a href="/sign-up">Sign up</a>
      </p>
    </main>
  );
}
