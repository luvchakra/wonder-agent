"use client";

import { useRouter } from "next/navigation";
import { ConfirmActionDialog, type ConfirmActionResult, Button } from "@/modules/ui";

/**
 * EXPERIENCE-P0-04 — revoking a grant removes effective access from this
 * agent, so it gets a real confirmation rather than a bare action. Wired to
 * the existing DELETE /api/v1/access/grants/:id route (unchanged), matching
 * this codebase's established ConfirmActionDialog consumer pattern
 * (MergeDuplicateButton, RemoveRoleButton).
 */
export function RevokeGrantButton({ grantId, application, entitlementName }: { grantId: string; application: string; entitlementName: string }) {
  const router = useRouter();

  async function handleConfirm(): Promise<ConfirmActionResult> {
    const res = await fetch(`/api/v1/access/grants/${grantId}`, { method: "DELETE" });
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
          Revoke
        </Button>
      }
      title="Revoke access grant"
      description={`This removes "${entitlementName}" on ${application} from this agent's effective access.`}
      scopePreview="1 grant revoked; the agent loses this entitlement immediately."
      confirmLabel="Revoke access"
      onConfirm={handleConfirm}
      onDone={() => router.refresh()}
    />
  );
}
