"use client";

import { useActionState, useState } from "react";
import { assignUserRoleAction, changeUserStatusAction, revokeSessionsAction, updateUserNameAction, type ActionState } from "@/app/actions/users";
import { Button, PendingSubmitButton, fieldInputClass, fieldLabelClass } from "@/modules/ui";
import { cn } from "@/lib/utils";
import type { MembershipStatus, StatusAction } from "@/lib/users/userRules";
import { AssignmentTermsFields, type ScopeOption } from "../../roles/AssignmentTermsFields";

/**
 * FOUNDATION-P0-23 — the user detail page's actions. Every one waits for
 * the server's answer and shows it as given (never an optimistic "done",
 * CLAUDE.md §15/§17.5); consequential ones open a confirmation with the
 * reason the audit log keeps.
 */

const initial: ActionState = { ok: false, message: null };

function Result({ state }: { state: ActionState }) {
  if (!state.message) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      className={cn("rounded-md border px-3 py-2 text-sm", state.ok ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive/10 text-destructive")}
    >
      {state.message}
    </p>
  );
}

const ACTIONS: { action: StatusAction; label: string; from: MembershipStatus[]; permission: "suspend" | "remove"; destructive: boolean; explain: string }[] = [
  {
    action: "suspend",
    label: "Suspend",
    from: ["active", "invited"],
    permission: "suspend",
    destructive: true,
    explain: "Their access stops now and every session they hold is ended. You can reactivate them later.",
  },
  { action: "reactivate", label: "Reactivate", from: ["suspended", "deactivated"], permission: "suspend", destructive: false, explain: "Their roles take effect again." },
  {
    action: "deactivate",
    label: "Deactivate",
    from: ["active", "invited", "suspended"],
    permission: "suspend",
    destructive: true,
    explain: "For people who have left. Access stops and sessions end; the record and roles stay.",
  },
  {
    action: "remove",
    label: "Remove from organization",
    from: ["active", "invited", "suspended", "deactivated"],
    permission: "remove",
    destructive: true,
    explain: "They leave the organization and lose every role here. The history stays in the audit log.",
  },
];

export function StatusActions({
  userId,
  name,
  status,
  canSuspend,
  canRemove,
}: {
  userId: string;
  name: string;
  status: MembershipStatus;
  canSuspend: boolean;
  canRemove: boolean;
}) {
  const [state, formAction] = useActionState(changeUserStatusAction, initial);
  const [open, setOpen] = useState<StatusAction | null>(null);
  const available = ACTIONS.filter((a) => a.from.includes(status) && (a.permission === "suspend" ? canSuspend : canRemove));
  const chosen = ACTIONS.find((a) => a.action === open);
  if (!available.length) return null;

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <Result state={state} />
      {chosen ? (
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="action" value={chosen.action} />
          <p className="text-sm font-medium text-foreground">
            {chosen.label} {name}?
          </p>
          <p className="text-xs text-muted-foreground">{chosen.explain}</p>
          <div>
            <label htmlFor="status-reason" className={fieldLabelClass}>
              Reason{chosen.action === "reactivate" ? " (optional)" : ""}
            </label>
            <textarea id="status-reason" name="reason" rows={2} maxLength={1000} required={chosen.action !== "reactivate"} className={fieldInputClass} />
          </div>
          <div className="flex flex-wrap gap-2">
            <PendingSubmitButton size="sm" variant={chosen.destructive ? "destructive" : "default"} pendingLabel="Working…">
              {chosen.label}
            </PendingSubmitButton>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          {available.map((a) => (
            <Button
              key={a.action}
              type="button"
              size="sm"
              variant={a.destructive ? "outline" : "default"}
              className={a.destructive ? "text-destructive" : undefined}
              onClick={() => setOpen(a.action)}
            >
              {a.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

export function EditNameForm({ userId, name }: { userId: string; name: string }) {
  const [state, formAction] = useActionState(updateUserNameAction, initial);
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <div className="space-y-2">
        {state.ok ? <Result state={state} /> : null}
        <Button type="button" size="sm" variant="outline" className="w-full" onClick={() => setEditing(true)}>
          Edit name
        </Button>
      </div>
    );
  }
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="userId" value={userId} />
      <label htmlFor="edit-name" className={fieldLabelClass}>
        Full name
      </label>
      <input id="edit-name" name="displayName" defaultValue={name} required maxLength={120} className={fieldInputClass} />
      <Result state={state} />
      <div className="flex gap-2">
        <PendingSubmitButton size="sm" pendingLabel="Saving…">
          Save
        </PendingSubmitButton>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Done
        </Button>
      </div>
    </form>
  );
}

export function AssignRoleForm({
  userId,
  roles,
  applications = [],
  agents = [],
}: {
  userId: string;
  roles: { name: string; label: string }[];
  applications?: ScopeOption[];
  agents?: ScopeOption[];
}) {
  const [state, formAction] = useActionState(assignUserRoleAction, initial);
  if (!roles.length) return <p className="text-xs text-muted-foreground">They hold every role there is to assign.</p>;
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="userId" value={userId} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[14rem]">
          <label htmlFor="assign-role" className={fieldLabelClass}>
            Assign a role
          </label>
          <select id="assign-role" name="role" required className={fieldInputClass} defaultValue="">
            <option value="" disabled>
              Choose a role
            </option>
            {roles.map((r) => (
              <option key={r.name} value={r.name}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <PendingSubmitButton size="sm" pendingLabel="Assigning…">
          Assign role
        </PendingSubmitButton>
      </div>
      <AssignmentTermsFields idPrefix="assign" applications={applications} agents={agents} errors={state.errors} />
      <Result state={state} />
    </form>
  );
}

export function RevokeSessionsForm({ userId }: { userId: string }) {
  const [state, formAction] = useActionState(revokeSessionsAction, initial);
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="space-y-2">
      <Result state={state} />
      {confirm ? (
        <form action={formAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="userId" value={userId} />
          <span className="text-sm text-foreground">End every session? They will have to sign in again.</span>
          <PendingSubmitButton size="sm" variant="destructive" pendingLabel="Ending…">
            End sessions
          </PendingSubmitButton>
          <Button type="button" size="sm" variant="ghost" onClick={() => setConfirm(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <Button type="button" size="sm" variant="outline" className="text-destructive" onClick={() => setConfirm(true)}>
          Revoke all sessions
        </Button>
      )}
    </div>
  );
}
