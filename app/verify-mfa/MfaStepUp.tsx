"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/db/supabaseBrowser";
import { Button, fieldInputClass, fieldLabelClass } from "@/modules/ui";
import { cn } from "@/lib/utils";

type Factor = { id: string; status: string };
type Setup = { factorId: string; qrCode: string; secret: string };

/**
 * FOUNDATION-P0-27 — raises the session to aal2 with Supabase Auth's own TOTP
 * MFA: verify an authenticator app already set up, or set one up now. On
 * success the page reloads and the server decides again; nothing here
 * grants anything by itself.
 */
export function MfaStepUp() {
  const router = useRouter();
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabaseBrowser()
      .auth.mfa.listFactors()
      .then(({ data, error }) => {
        if (error) setError("Your authenticator apps could not be loaded. Reload the page to try again.");
        else setFactors((data?.totp ?? []) as Factor[]);
      });
  }, []);

  const verified = factors?.find((f) => f.status === "verified") ?? null;

  async function startSetup() {
    setBusy(true);
    setError(null);
    const auth = supabaseBrowser().auth;
    // A setup left unfinished earlier would block a new one; remove it first.
    for (const f of factors ?? []) if (f.status !== "verified") await auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await auth.mfa.enroll({ factorType: "totp" });
    setBusy(false);
    if (error || !data) {
      setError("An authenticator app could not be set up. Try again.");
      return;
    }
    setSetup({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    const factorId = setup?.factorId ?? verified?.id;
    if (!factorId) return;
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    if (error) {
      setBusy(false);
      setError("That code didn't work. Check the time on your device and enter the newest code.");
      return;
    }
    // The session is now aal2; load the organization again so the server decides.
    router.replace("/");
    router.refresh();
  }

  if (factors === null) return <p className="text-sm text-muted-foreground">{error ?? "Loading…"}</p>;

  if (!verified && !setup) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">You don&apos;t have an authenticator app set up yet.</p>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <Button type="button" onClick={startSetup} disabled={busy}>
          {busy ? "Starting…" : "Set up an authenticator app"}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={verify} className="space-y-3">
      {setup ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Scan this with your authenticator app, or enter the key by hand.</p>
          {/* Supabase returns the QR code as an SVG data URL. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qrCode} alt="QR code for your authenticator app" className="size-40 rounded-md border border-border bg-white p-2" />
          <code className="block break-all rounded-md bg-muted px-2 py-1 text-xs">{setup.secret}</code>
        </div>
      ) : null}
      <div>
        <label htmlFor="mfa-code" className={fieldLabelClass}>
          6-digit code
        </label>
        <input
          id="mfa-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          aria-invalid={error ? true : undefined}
          className={cn(fieldInputClass, "max-w-[10rem] font-mono tracking-widest")}
        />
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" disabled={busy || code.length !== 6}>
        {busy ? "Verifying…" : "Verify"}
      </Button>
    </form>
  );
}
