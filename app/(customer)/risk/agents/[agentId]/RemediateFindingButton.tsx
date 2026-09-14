"use client";

import { useRouter } from "next/navigation";
import { ConfirmActionDialog, type ConfirmActionResult } from "@/modules/ui/ConfirmAction";
import { Button } from "@/modules/ui/Button";

/**
 * EXPERIENCE-P0-04 — the first real consumer of ConfirmActionDialog,
 * wired to Risk Agent's existing `POST /api/v1/findings/:id/remediate`
 * (unchanged — this is a UI-only change, non-negotiable #18). The
 * underlying authorization decision (whether remediation is allowed, and
 * whether it's actually wired to a real IAM hand-off) stays entirely
 * Risk Agent's; this component only renders the confirm/in-flight/result
 * UX consistently, per non-negotiable #15.
 */
export function RemediateFindingButton({ findingId, findingTitle }: { findingId: string; findingTitle: string }) {
  const router = useRouter();

  async function handleConfirm(): Promise<ConfirmActionResult> {
    const res = await fetch(`/api/v1/findings/${findingId}/remediate`, { method: "POST" });
    const body = await res.json();
    if (!res.ok || !body.ok) {
      return { kind: "single", success: false, error: body.error?.message ?? "Request failed" };
    }
    return { kind: "single", success: true };
  }

  return (
    <ConfirmActionDialog
      trigger={<Button variant="destructive">Request remediation</Button>}
      title="Request remediation"
      description={`This records a remediation request for "${findingTitle}" and audits it.`}
      scopePreview="1 finding affected. Whether this reaches a real IAM workflow depends on whether Access Agent's remediation-initiation contract is wired yet — the result below will say."
      confirmLabel="Request remediation"
      onConfirm={handleConfirm}
      onDone={() => router.refresh()}
    />
  );
}
