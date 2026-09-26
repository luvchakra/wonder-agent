"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/db/supabaseBrowser";
import { signInAction } from "@/app/actions/auth";
import { AuthShell, Button, GoogleAuthButton, TenantLogo, TextField } from "@/modules/ui";

/** The organization an address names, as the sign-in page may show it (FOUNDATION-P0-22). */
export type SignInTenant = { name: string; suspended: boolean } | null;

export function SignInFormBoundary({ tenant }: { tenant: SignInTenant }) {
  return (
    <Suspense>
      <SignInForm tenant={tenant} />
    </Suspense>
  );
}

function SignInForm({ tenant }: { tenant: SignInTenant }) {
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
    // Go to the app, not the organization picker. `app/(customer)/layout.tsx`
    // already redirects to /onboarding when getTenantContext() resolves no
    // tenant (a brand-new user with no membership yet), so pushing there
    // unconditionally only made every returning single-tenant user sit
    // through a "Select an organization" interstitial on each sign-in.
    router.push("/");
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
    <AuthShell
      title={tenant ? "Sign in to your organization" : "Sign in to WonderID"}
      subtitle="Secure access for every identity."
      footer={
        tenant ? (
          <>Not part of {tenant.name}? Use the WonderID address your administrator gave you.</>
        ) : (
          <>
            Need an account?{" "}
            <Link href="/sign-up" className="font-medium text-primary hover:underline">
              Sign up
            </Link>
          </>
        )
      }
    >
      {tenant ? (
        <div className="mb-5 flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5" data-testid="sign-in-tenant">
          <TenantLogo name={tenant.name} size={36} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{tenant.name}</p>
            <p className="text-xs text-muted-foreground">Secure access powered by WonderID</p>
          </div>
        </div>
      ) : null}
      {tenant?.suspended ? (
        <p role="alert" className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {tenant.name} is suspended. Sign-in is paused; contact your administrator.
        </p>
      ) : null}
      <form onSubmit={handleSubmit} className="space-y-4">
        <fieldset disabled={Boolean(tenant?.suspended)} className="space-y-4">
          <TextField label="Email" name="email" className="h-10 px-3" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <TextField
            label="Password"
            name="password"
            className="h-10 px-3"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div className="-mt-2 text-right text-sm">
            <Link href="/forgot-password" className="font-medium text-primary hover:underline">
              Forgot password?
            </Link>
          </div>

          {sessionExpired && !error ? (
            <p role="status" className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-foreground">
              Your session expired. Please sign in again.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
        </fieldset>
      </form>

      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
        <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
      </div>

      <div className="space-y-2">
        {/* On an organization's address, only its own sign-in methods: Google's redirect allowlist does not include tenant addresses yet. */}
        {tenant ? null : <GoogleAuthButton label="Sign in with Google" />}
        <Button type="button" variant="outline" onClick={handleSsoSignIn} disabled={ssoChecking || Boolean(tenant?.suspended)} className="w-full">
          {ssoChecking ? "Checking…" : "Sign in with SSO"}
        </Button>
      </div>
    </AuthShell>
  );
}
