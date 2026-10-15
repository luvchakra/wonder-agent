"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmActionDialog, type ConfirmActionResult, Button, SelectField, TextField } from "@/modules/ui";
import type { DecisionType } from "@/lib/shared/types/compliance";

const AGENT_DECISIONS: DecisionType[] = ["approve", "revoke", "modify", "delegate", "request_information"];
/** COMPLIANCE-P0-10 part 2: a person's access or WonderID role. */
const PERSON_DECISIONS: DecisionType[] = ["approve", "revoke", "exception", "defer", "escalate", "delegate", "request_information"];
/** COMPLIANCE-P0-10 part 3: a resource in an access package (no exception: it stays or goes). */
const PACKAGE_DECISIONS: DecisionType[] = ["approve", "revoke", "defer", "escalate", "delegate", "request_information"];
const LABEL: Partial<Record<DecisionType, string>> = { approve: "certify", exception: "exception (keep until)", defer: "defer (review later)", request_information: "request information" };

export type DecisionSubject = "agent" | "person" | "role" | "package" | "entitlement";

const REVOKE_COPY: Record<DecisionSubject, { description: string; scope: string }> = {
  agent: { description: "This calls revokeAccessGrant() for this item's access grant — the agent loses this access immediately.", scope: "1 access grant revoked." },
  person: { description: "This approves the removal of this access. It is carried out by a task or the connection, and counted as done once the system no longer shows it.", scope: "1 approved removal." },
  role: { description: "The role is removed now (or the person leaves the group it comes from).", scope: "1 role assignment removed." },
  entitlement: { description: "The entitlement is disabled now: nobody can request it. People who hold it keep it until an access review removes it.", scope: "1 entitlement disabled." },
  package: { description: "It is removed from the package now. People who already hold the package keep their access; a birthright package waits for approval again.", scope: "1 resource removed from the package." },
};

/**
 * EXPERIENCE-P0-04 — "revoke" really calls revokeAccessGrant() (Compliance
 * Agent's own audit log), so it gets a real confirmation before submitting;
 * every other decision submits directly. Wired to the existing
 * POST /api/v1/compliance/items/:id/decisions route (unchanged).
 */
export function DecisionForm({ itemId, subject = "agent" }: { itemId: string; subject?: DecisionSubject }) {
  const decisions = subject === "agent" ? AGENT_DECISIONS : subject === "package" || subject === "entitlement" ? PACKAGE_DECISIONS : PERSON_DECISIONS;
  const router = useRouter();
  const [decision, setDecision] = useState<DecisionType>("approve");
  const [justification, setJustification] = useState("");
  const [delegateToUserId, setDelegateToUserId] = useState("");
  const [overrideSoD, setOverrideSoD] = useState(false);
  const [until, setUntil] = useState("");
  const [askEmail, setAskEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<ConfirmActionResult> {
    // COMPLIANCE-P0-14 part 3: asking someone is recorded first, while the item is still open.
    if (decision === "request_information" && askEmail.trim()) {
      const asked = await fetch(`/api/v1/compliance/items/${itemId}/consultations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ askedOfEmail: askEmail.trim(), question: justification }),
      });
      const askedBody = await asked.json();
      if (!asked.ok || !askedBody.ok) return { kind: "single", success: false, error: askedBody.error?.message ?? "Request failed" };
    }
    const res = await fetch(`/api/v1/compliance/items/${itemId}/decisions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, justification, delegateToUserId: delegateToUserId || undefined, overrideSoD, until: until ? new Date(`${until}T23:59:59Z`).toISOString() : undefined }),
    });
    const body = await res.json();
    if (!res.ok || !body.ok) {
      return { kind: "single", success: false, error: body.error?.message ?? "Request failed" };
    }
    return { kind: "single", success: true };
  }

  async function handleDirectSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const result = await submit();
    if (result.kind === "single" && result.success) router.refresh();
    else if (result.kind === "single") setError(result.error ?? "Request failed");
  }

  const fields = (
    <>
      <SelectField label="Decision" name="decision" value={decision} onChange={(e) => setDecision(e.target.value as DecisionType)}>
        {decisions.map((d) => (
          <option key={d} value={d}>
            {LABEL[d] ?? d}
          </option>
        ))}
      </SelectField>
      <TextField label="Justification" name="justification" required value={justification} onChange={(e) => setJustification(e.target.value)} />
      {decision === "delegate" && (
        <TextField
          label="Delegate to"
          name="delegateToUserId"
          placeholder="user id (uuid)"
          value={delegateToUserId}
          onChange={(e) => setDelegateToUserId(e.target.value)}
        />
      )}
      {decision === "request_information" && (
        <TextField label="Ask (optional)" name="askEmail" type="email" placeholder="their email" value={askEmail} onChange={(e) => setAskEmail(e.target.value)} />
      )}
      {(decision === "defer" || decision === "exception") && (
        <TextField label={decision === "defer" ? "Review by" : "Keep until"} name="until" type="date" required value={until} onChange={(e) => setUntil(e.target.value)} />
      )}
      {decision === "approve" && subject === "agent" && (
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={overrideSoD} onChange={(e) => setOverrideSoD(e.target.checked)} />
          Override SoD (only if you own this agent)
        </label>
      )}
    </>
  );

  if (decision === "revoke") {
    return (
      <div className="flex flex-wrap items-end gap-2">
        {fields}
        <ConfirmActionDialog
          trigger={
            <Button variant="destructive" disabled={!justification.trim()}>
              Submit
            </Button>
          }
          title="Revoke access"
          description={REVOKE_COPY[subject].description}
          scopePreview={REVOKE_COPY[subject].scope}
          reasonRequired={false}
          confirmLabel="Revoke access"
          onConfirm={submit}
          onDone={(result) => {
            if (result.kind === "single" && result.success) router.refresh();
          }}
        />
      </div>
    );
  }

  return (
    <form onSubmit={handleDirectSubmit} className="flex flex-wrap items-end gap-2">
      {fields}
      <Button type="submit" variant="secondary" disabled={!justification.trim() || ((decision === "defer" || decision === "exception") && !until)}>
        Submit
      </Button>
      {error && (
        <p role="alert" className="w-full text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
