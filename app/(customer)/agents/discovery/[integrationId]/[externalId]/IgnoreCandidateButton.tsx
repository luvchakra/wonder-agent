"use client";

import { useRouter } from "next/navigation";
import { ConfirmActionDialog, type ConfirmActionResult, Button } from "@/modules/ui";

/**
 * Agent Discovery — same ConfirmActionDialog + fetch pattern established by
 * MergeDuplicateButton (app/(customer)/agents/duplicates/MergeDuplicateButton.tsx),
 * wired to POST /api/v1/agents/discovery/decision (recordDiscoveryDecision).
 */
export function IgnoreCandidateButton({
  sourceSystem,
  sourceObjectId,
  displayName,
}: {
  sourceSystem: string;
  sourceObjectId: string;
  displayName: string;
}) {
  const router = useRouter();

  async function handleConfirm(): Promise<ConfirmActionResult> {
    const res = await fetch("/api/v1/agents/discovery/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceSystem, sourceObjectId, displayName, decisionType: "ignored" }),
    });
    const body = await res.json();
    if (!res.ok || !body.ok) {
      return { kind: "single", success: false, error: body.error?.message ?? "Request failed" };
    }
    return { kind: "single", success: true };
  }

  return (
    <ConfirmActionDialog
      trigger={
        <Button variant="destructive" size="sm">
          Ignore
        </Button>
      }
      title="Ignore this candidate"
      description={`"${displayName}" moves to the Ignored tab and won't be surfaced for review again unless you revisit it there.`}
      scopePreview="1 candidate ignored; no agent, IAM access, or identity link is affected."
      confirmLabel="Ignore candidate"
      onConfirm={handleConfirm}
      onDone={() => router.push("/agents/discovery")}
    />
  );
}
