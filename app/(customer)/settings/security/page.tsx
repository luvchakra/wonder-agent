"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/db/supabaseBrowser";
import { Card, CardBody, CardHeader, TableContainer, Thead, Th, Tr, Td, EmptyState, Badge } from "@/modules/ui";

type Factor = { id: string; friendly_name?: string; factor_type: string; status: string };

// FOUNDATION-P0-03.4 — MFA foundation. Uses Supabase Auth's own built-in
// TOTP MFA (mfa.enroll/mfa.challenge/mfa.verify/mfa.listFactors/
// mfa.unenroll) exclusively — no custom TOTP implementation. Bare form,
// not styled to the full UI-UX-DESIGN-RULES standard yet (functional
// scaffolding per CLAUDE.md §13, reusing modules/ui/* primitives).
export default function SecuritySettingsPage() {
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [pendingFactorId, setPendingFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refreshFactors() {
    const supabase = supabaseBrowser();
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) {
      setError(error.message);
      return;
    }
    setFactors((data?.totp ?? []) as Factor[]);
  }

  useEffect(() => {
    // Inlined (rather than calling the shared refreshFactors() helper) so
    // the setState calls happen inside a promise callback, not synchronously
    // within the effect body — see the react-hooks/set-state-in-effect rule
    // this codebase enforces (same pattern ThemeToggle uses elsewhere).
    supabaseBrowser()
      .auth.mfa.listFactors()
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setFactors((data?.totp ?? []) as Factor[]);
      });
  }, []);

  async function handleEnroll() {
    setError(null);
    setMessage(null);
    setEnrolling(true);
    const supabase = supabaseBrowser();
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
    setEnrolling(false);
    if (error) {
      setError(error.message);
      return;
    }
    setPendingFactorId(data.id);
    setQrCode(data.totp.qr_code);
    setSecret(data.totp.secret);
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingFactorId) return;
    setError(null);
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: pendingFactorId,
      code,
    });
    if (error) {
      setError(error.message);
      return;
    }
    setMessage("MFA enrolled successfully.");
    setPendingFactorId(null);
    setQrCode(null);
    setSecret(null);
    setCode("");
    await refreshFactors();
  }

  async function handleUnenroll(factorId: string) {
    setError(null);
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) {
      setError(error.message);
      return;
    }
    await refreshFactors();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-foreground">Security — Multi-Factor Authentication</h1>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {message ? <p className="text-sm text-success">{message}</p> : null}

      <Card>
        <CardHeader title="Authenticator app (TOTP) factors" />
        <CardBody>
          {factors === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : factors.length === 0 ? (
            <EmptyState title="No MFA factors enrolled" />
          ) : (
            <TableContainer>
              <Thead>
                <tr>
                  <Th>Factor</Th>
                  <Th>Status</Th>
                  <Th>Actions</Th>
                </tr>
              </Thead>
              <tbody>
                {factors.map((f) => (
                  <Tr key={f.id}>
                    <Td>{f.friendly_name ?? f.id}</Td>
                    <Td>
                      <Badge tone={f.status === "verified" ? "success" : "neutral"}>{f.status}</Badge>
                    </Td>
                    <Td>
                      <button className="text-destructive hover:underline" onClick={() => handleUnenroll(f.id)}>
                        Remove
                      </button>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableContainer>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Add an authenticator app" />
        <CardBody className="space-y-3">
          {!pendingFactorId ? (
            <button
              onClick={handleEnroll}
              disabled={enrolling}
              className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground"
            >
              {enrolling ? "Starting…" : "Enroll a new authenticator app"}
            </button>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Scan this QR code with your authenticator app, or enter the secret manually.
              </p>
              {qrCode ? (
                // eslint-disable-next-line @next/next/no-img-element -- Supabase returns a raw SVG data payload, not a static asset.
                <img
                  alt="TOTP enrollment QR code"
                  src={`data:image/svg+xml;utf-8,${qrCode}`}
                  className="h-40 w-40 border border-border bg-white p-2"
                />
              ) : null}
              {secret ? <p className="font-mono text-xs text-muted-foreground">Secret: {secret}</p> : null}
              <form onSubmit={handleVerify} className="flex items-end gap-2">
                <label className="text-sm text-muted-foreground">
                  6-digit code
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    required
                    maxLength={6}
                    className="mt-1 block w-32 rounded border border-border bg-background px-2 py-1 text-foreground"
                  />
                </label>
                <button type="submit" className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground">
                  Verify
                </button>
              </form>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
