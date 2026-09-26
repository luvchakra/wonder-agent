"use client";

import { useActionState, useState } from "react";
import { deleteRoleAction, setRoleStatusAction, type RoleActionState } from "@/app/actions/customRoles";
import { Button, PendingSubmitButton } from "@/modules/ui";
import { cn } from "@/lib/utils";

// FOUNDATION-P0-25 — activate, deactivate or delete a custom role. Each
// waits for the server's answer and shows it as given; deactivating says
// what it does to the people who hold the role.

const initial: RoleActionState = { ok: false, message: null };

export function RoleStatusActions({
  roleId,
  status,
  canUpdate,
  canDelete,
  holders,
}: {
  roleId: string;
  status: "active" | "inactive";
  canUpdate: boolean;
  canDelete: boolean;
  holders: number;
}) {
  const [statusState, statusAction] = useActionState(setRoleStatusAction, initial);
  const [deleteState, deleteAction] = useActionState(deleteRoleAction, initial);
  const [confirm, setConfirm] = useState<"status" | "delete" | null>(null);
  const message = statusState.message ? statusState : deleteState.message ? deleteState : null;

  return (
    <div className="space-y-3 border-t border-border pt-4">
      {message ? (
        <p
          role={message.ok ? "status" : "alert"}
          className={cn(
            "rounded-md border px-3 py-2 text-sm",
            message.ok ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive/10 text-destructive",
          )}
        >
          {message.message}
        </p>
      ) : null}
      {confirm === "status" ? (
        <form action={statusAction} className="space-y-2">
          <input type="hidden" name="roleId" value={roleId} />
          <input type="hidden" name="status" value={status === "active" ? "inactive" : "active"} />
          <p className="text-sm text-foreground">
            {status === "active"
              ? `Deactivate this role? ${holders ? `The ${holders} ${holders === 1 ? "person" : "people"} holding it lose its permissions on their next request.` : "Nobody holds it now."}`
              : "Activate this role? Its holders get its permissions again."}
          </p>
          <div className="flex gap-2">
            <PendingSubmitButton size="sm" variant={status === "active" ? "destructive" : "default"} pendingLabel="Saving…">
              {status === "active" ? "Deactivate" : "Activate"}
            </PendingSubmitButton>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : confirm === "delete" ? (
        <form action={deleteAction} className="space-y-2">
          <input type="hidden" name="roleId" value={roleId} />
          <p className="text-sm text-foreground">Delete this role? It can&apos;t be undone; the audit log keeps its history.</p>
          <div className="flex gap-2">
            <PendingSubmitButton size="sm" variant="destructive" pendingLabel="Deleting…">
              Delete role
            </PendingSubmitButton>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          {canUpdate ? (
            <Button type="button" size="sm" variant="outline" className={status === "active" ? "text-destructive" : undefined} onClick={() => setConfirm("status")}>
              {status === "active" ? "Deactivate" : "Activate"}
            </Button>
          ) : null}
          {canDelete ? (
            <Button type="button" size="sm" variant="outline" className="text-destructive" onClick={() => setConfirm("delete")}>
              Delete
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
