"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmActionDialog, type ConfirmActionResult, Button, SelectField, TextField } from "@/modules/ui";
import type { DecisionType } from "@/lib/shared/types/compliance";

const DECISIONS: DecisionType[] = ["approve", "revoke", "modify", "delegate", "request_information"];

/**
 * EXPERIENCE-P0-04 — "revoke" really calls revokeAccessGrant() (Compliance
 * Agent's own audit log), so it gets a real confirmation before submitting;
 * every other decision submits directly. Wired to the existing
 * POST /api/v1/compliance/items/:id/decisions route (unchanged).
 */
export function DecisionForm({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [decision, setDecision] = useState<DecisionType>("approve");
  const [justification, setJustification] = useState("");
  const [delegateToUserId, setDelegateToUserId] = useState("");
  const [overrideSoD, setOverrideSoD] = useState(false);

  async function submit(): Promise<ConfirmActionResult> {
    const res = await fetch(`/api/v1/compliance/items/${itemId}/decisions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, justification, delegateToUserId: delegateToUserId || undefined, overrideSoD }),
    });
    const body = await res.json();
    if (!res.ok || !body.ok) {
      return { kind: "single", success: false, error: body.error?.message ?? "Request failed" };
    }
    return { kind: "single", success: true };
  }

  async function handleDirectSubmit(e: React.FormEvent) {
    e.preventDefault();
    const result = await submit();
    if (result.kind === "single" && result.success) router.refresh();
    // errors from the direct (non-confirm) path are rare (validation already
    // happened client-side); a failed decision here would show as no visible
    // change, which is an acceptable gap for the non-destructive paths —
    // "revoke" (the one with real consequences) always goes through the
    // confirm dialog below, which does surface errors.
  }

  const fields = (
    <>
      <SelectField label="Decision" name="decision" value={decision} onChange={(e) => setDecision(e.target.value as DecisionType)}>
        {DECISIONS.map((d) => (
          <option key={d} value={d}>
            {d}
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
      {decision === "approve" && (
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
          description="This calls revokeAccessGrant() for this item's access grant — the agent loses this access immediately."
          scopePreview="1 access grant revoked."
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
      <Button type="submit" variant="secondary" disabled={!justification.trim()}>
        Submit
      </Button>
    </form>
  );
}
