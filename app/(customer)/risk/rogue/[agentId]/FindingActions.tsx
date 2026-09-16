"use client";

import { useRouter } from "next/navigation";
import { ConfirmActionDialog, type ConfirmActionResult, Button } from "@/modules/ui";

/**
 * EXPERIENCE-P0-13 — the per-finding half of PRD §37's action set ("Create
 * remediation," "Mark false positive"). Reuses the exact same routes the
 * general Risk tab's own finding actions already call
 * (`RemediateFindingButton`, `resolveFindingAction` → `POST
 * /api/v1/findings/:id/resolve`) — this page never had either affordance
 * before, so wiring them here is new UI, not new business logic.
 */
export function FindingActions({ findingId, findingTitle }: { findingId: string; findingTitle: string }) {
  const router = useRouter();

  async function remediate(): Promise<ConfirmActionResult> {
    const res = await fetch(`/api/v1/findings/${findingId}/remediate`, { method: "POST" });
    const body = await res.json();
    if (!res.ok || !body.ok) return { kind: "single", success: false, error: body.error?.message ?? "Request failed" };
    return { kind: "single", success: true };
  }

  async function markFalsePositive(reason: string): Promise<ConfirmActionResult> {
    const res = await fetch(`/api/v1/findings/${findingId}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "false_positive", reason }),
    });
    const body = await res.json();
    if (!res.ok || !body.ok) return { kind: "single", success: false, error: body.error?.message ?? "Request failed" };
    return { kind: "single", success: true };
  }

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <ConfirmActionDialog
        trigger={
          <Button variant="destructive" size="sm">
            Create remediation
          </Button>
        }
        title="Request remediation"
        description={`This records a remediation request for "${findingTitle}" and audits it.`}
        scopePreview="1 finding affected. Whether this reaches a real IAM workflow depends on whether Access Agent's remediation-initiation contract is wired yet."
        confirmLabel="Request remediation"
        onConfirm={remediate}
        onDone={() => router.refresh()}
      />

      <ConfirmActionDialog
        trigger={
          <Button variant="outline" size="sm">
            Mark false positive
          </Button>
        }
        title="Mark as false positive"
        description={`This marks "${findingTitle}" as a false positive — it will no longer count as an open rogue-behavior finding.`}
        reasonRequired
        confirmLabel="Mark false positive"
        onConfirm={markFalsePositive}
        onDone={() => router.refresh()}
      />
    </div>
  );
}
