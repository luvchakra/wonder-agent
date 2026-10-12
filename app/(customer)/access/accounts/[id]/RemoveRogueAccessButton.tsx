"use client";

import { useRouter } from "next/navigation";
import { ConfirmActionDialog, type ConfirmActionResult } from "@/modules/ui/ConfirmAction";
import { Button } from "@/modules/ui/Button";

/**
 * RISK-P0-13 (core, F3): asks for rogue access to be removed. The result
 * shown is the server's: a request was raised (waiting for approval, or
 * approved under the application's policy), never "removed": the change is
 * made by fulfilment and verified by the next reconciliation.
 */
export function RemoveRogueAccessButton({ findingId, what, disable }: { findingId: string; what: string; disable: boolean }) {
  const router = useRouter();

  async function handleConfirm(): Promise<ConfirmActionResult> {
    const res = await fetch(`/api/v1/findings/${findingId}/request-removal`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) return { kind: "single", success: false, error: body.error?.message ?? "The request could not be raised" };
    return { kind: "single", success: true };
  }

  return (
    <ConfirmActionDialog
      trigger={
        <Button size="sm" variant="outline">
          {disable ? "Disable account" : "Remove access"}
        </Button>
      }
      title={disable ? "Disable this account" : "Remove this access"}
      description={`Raises a request to ${disable ? "disable" : "remove"} ${what}. The application's approval rules apply; the change is made on the system and verified by the next sync.`}
      confirmLabel="Request it"
      onConfirm={handleConfirm}
      onDone={() => router.refresh()}
    />
  );
}
