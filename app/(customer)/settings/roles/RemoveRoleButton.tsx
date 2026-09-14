"use client";

import { useRouter } from "next/navigation";
import { ConfirmActionDialog, type ConfirmActionResult } from "@/modules/ui";
import { removeRoleAction } from "@/app/actions/roles";

/**
 * EXPERIENCE-P0-04 — removing a role can lock someone out of the tenant
 * (e.g. their last role), so it gets a real confirmation rather than a
 * bare "×" button. Calls the existing removeRoleAction Server Action
 * directly (no new API route — it doesn't redirect, only revalidates, so
 * direct invocation from a Client Component is safe here, unlike actions
 * that redirect internally).
 */
export function RemoveRoleButton({ userId, role }: { userId: string; role: string }) {
  const router = useRouter();

  async function handleConfirm(): Promise<ConfirmActionResult> {
    const formData = new FormData();
    formData.set("userId", userId);
    formData.set("role", role);
    try {
      await removeRoleAction(formData);
      return { kind: "single", success: true };
    } catch (err) {
      return { kind: "single", success: false, error: err instanceof Error ? err.message : "Request failed" };
    }
  }

  return (
    <ConfirmActionDialog
      trigger={
        <button type="button" className="text-xs text-destructive hover:underline" aria-label={`Remove ${role}`}>
          ×
        </button>
      }
      title="Remove role"
      description={`This removes the "${role}" role from this user immediately.`}
      scopePreview="1 role removed from 1 user."
      confirmLabel="Remove role"
      onConfirm={handleConfirm}
      onDone={(result) => {
        if (result.kind === "single" && result.success) router.refresh();
      }}
    />
  );
}
