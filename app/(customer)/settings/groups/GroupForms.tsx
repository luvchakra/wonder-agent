"use client";

import { useActionState, useState } from "react";
import {
  addGroupMemberAction,
  addGroupRoleAction,
  deleteGroupAction,
  removeGroupMemberAction,
  removeGroupRoleAction,
  saveGroupAction,
  type GroupActionState,
} from "@/app/actions/groups";
import { Button, PendingSubmitButton, fieldInputClass, fieldLabelClass } from "@/modules/ui";
import { cn } from "@/lib/utils";
import { AssignmentTermsFields, type ScopeOption } from "../roles/AssignmentTermsFields";

/**
 * FOUNDATION-P0-26 — the Groups screens' forms. Each waits for the server's
 * answer and shows it as given; removing and deleting ask first.
 */

const initial: GroupActionState = { ok: false, message: null };

function Result({ state }: { state: GroupActionState }) {
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

export function GroupDetailsForm({ groupId, name, description, submitLabel }: { groupId?: string; name?: string; description?: string | null; submitLabel: string }) {
  const [state, action] = useActionState(saveGroupAction, initial);
  const errors = state.errors ?? {};
  return (
    <form action={action} className="space-y-3">
      {groupId ? <input type="hidden" name="groupId" value={groupId} /> : null}
      <div>
        <label htmlFor={`group-name-${groupId ?? "new"}`} className={fieldLabelClass}>
          Group name
        </label>
        <input
          id={`group-name-${groupId ?? "new"}`}
          name="name"
          required
          minLength={2}
          maxLength={80}
          defaultValue={name ?? ""}
          className={fieldInputClass}
          aria-invalid={!!errors.name}
        />
        {errors.name ? <p className="mt-1 text-xs text-destructive">{errors.name}</p> : null}
      </div>
      <div>
        <label htmlFor={`group-description-${groupId ?? "new"}`} className={fieldLabelClass}>
          Description <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea id={`group-description-${groupId ?? "new"}`} name="description" rows={2} maxLength={500} defaultValue={description ?? ""} className={fieldInputClass} />
      </div>
      <Result state={state} />
      <PendingSubmitButton size="sm" pendingLabel="Saving…">
        {submitLabel}
      </PendingSubmitButton>
    </form>
  );
}

export function DeleteGroupButton({ groupId, members }: { groupId: string; members: number }) {
  const [state, action] = useActionState(deleteGroupAction, initial);
  const [confirm, setConfirm] = useState(false);
  if (!confirm) {
    return (
      <Button type="button" size="sm" variant="outline" className="text-destructive" onClick={() => setConfirm(true)}>
        Delete group
      </Button>
    );
  }
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="groupId" value={groupId} />
      <p className="text-sm text-foreground">
        Delete this group? {members ? `Its ${members} ${members === 1 ? "member loses" : "members lose"} the group's roles on their next request.` : ""}
      </p>
      <Result state={state} />
      <div className="flex gap-2">
        <PendingSubmitButton size="sm" variant="destructive" pendingLabel="Deleting…">
          Delete group
        </PendingSubmitButton>
        <Button type="button" size="sm" variant="ghost" onClick={() => setConfirm(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function AddMemberForm({ groupId, candidates }: { groupId: string; candidates: { userId: string; label: string }[] }) {
  const [state, action] = useActionState(addGroupMemberAction, initial);
  if (!candidates.length) return <p className="text-xs text-muted-foreground">Everyone in the organization is already in this group.</p>;
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="groupId" value={groupId} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[16rem] flex-1">
          <label htmlFor="add-member" className={fieldLabelClass}>
            Add a person
          </label>
          <select id="add-member" name="userId" required defaultValue="" className={fieldInputClass}>
            <option value="" disabled>
              Choose a person
            </option>
            {candidates.map((c) => (
              <option key={c.userId} value={c.userId}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <PendingSubmitButton size="sm" pendingLabel="Adding…">
          Add to group
        </PendingSubmitButton>
      </div>
      <Result state={state} />
    </form>
  );
}

export function RemoveMemberButton({ groupId, userId, name }: { groupId: string; userId: string; name: string }) {
  const [state, action] = useActionState(removeGroupMemberAction, initial);
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {state.message && !state.ok ? <span className="text-xs text-destructive">{state.message}</span> : null}
      {confirm ? (
        <form action={action} className="flex items-center gap-2">
          <input type="hidden" name="groupId" value={groupId} />
          <input type="hidden" name="userId" value={userId} />
          <PendingSubmitButton size="sm" variant="destructive" pendingLabel="Removing…">
            Remove
          </PendingSubmitButton>
          <Button type="button" size="sm" variant="ghost" onClick={() => setConfirm(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <Button type="button" size="sm" variant="ghost" className="text-destructive" aria-label={`Remove ${name} from the group`} onClick={() => setConfirm(true)}>
          Remove
        </Button>
      )}
    </div>
  );
}

export function AddGroupRoleForm({ groupId, roles, applications, agents }: { groupId: string; roles: { name: string; label: string }[]; applications: ScopeOption[]; agents: ScopeOption[] }) {
  const [state, action] = useActionState(addGroupRoleAction, initial);
  if (!roles.length) return <p className="text-xs text-muted-foreground">There are no roles to give.</p>;
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="groupId" value={groupId} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[16rem] flex-1">
          <label htmlFor="add-group-role" className={fieldLabelClass}>
            Give the group a role
          </label>
          <select id="add-group-role" name="role" required defaultValue="" className={fieldInputClass}>
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
      <AssignmentTermsFields idPrefix="group-role" applications={applications} agents={agents} errors={state.errors} />
      <Result state={state} />
    </form>
  );
}

export function RemoveGroupRoleButton({ groupId, roleId }: { groupId: string; roleId: string }) {
  const [state, action] = useActionState(removeGroupRoleAction, initial);
  return (
    <form action={action} className="flex items-center justify-end gap-2">
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="roleId" value={roleId} />
      {state.message && !state.ok ? <span className="text-xs text-destructive">{state.message}</span> : null}
      <PendingSubmitButton size="sm" variant="ghost" pendingLabel="Removing…">
        <span className="text-destructive">Remove</span>
      </PendingSubmitButton>
    </form>
  );
}
