"use client";

import { useRouter } from "next/navigation";
import { ConfirmActionDialog, type ConfirmActionResult, Button } from "@/modules/ui";

/**
 * EXPERIENCE-P0-04 — merging discards the pending registration permanently
 * (IDENTITY-P0-04's own semantics), so it gets a real confirmation rather
 * than a bare form button. Wired to the existing
 * PATCH /api/v1/agents/duplicates/:id route (unchanged) rather than
 * calling the server action directly, matching this codebase's established
 * ConfirmActionDialog consumer pattern (RemediateFindingButton).
 */
export function MergeDuplicateButton({ candidateId, candidateName }: { candidateId: string; candidateName: string }) {
  const router = useRouter();

  async function handleConfirm(): Promise<ConfirmActionResult> {
    const res = await fetch(`/api/v1/agents/duplicates/${candidateId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "merge" }),
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
          Merge
        </Button>
      }
      title="Merge duplicate registration"
      description={`This discards the pending registration for "${candidateName}" — it will not become a separate agent.`}
      scopePreview="1 pending registration discarded; the matched agent is unaffected."
      confirmLabel="Merge (same agent)"
      onConfirm={handleConfirm}
      onDone={() => router.refresh()}
    />
  );
}
