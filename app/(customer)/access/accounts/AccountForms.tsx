"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { linkAccountAction, reconcileAccountsAction, type AccountFormState } from "@/app/actions/accounts";
import { Button, SelectField } from "@/modules/ui";

// ACCESS-P0-17 — account forms; each shows the server's real result (§17.5).

const IDLE: AccountFormState = { status: "idle" };

function Result({ state }: { state: AccountFormState }) {
  return (
    <p role="status" className="min-h-5 text-xs">
      {state.status === "saved" ? <span className="text-success">{state.message}</span> : null}
      {state.status === "error" ? <span className="text-destructive">{state.message}</span> : null}
    </p>
  );
}

export function LinkAccountForm({
  accountId,
  currentIdentityId,
  currentIdentityName,
  identities,
}: {
  accountId: string;
  currentIdentityId: string | null;
  currentIdentityName: string | null;
  identities: { id: string; label: string }[];
}) {
  const showCurrent = currentIdentityId && !identities.some((i) => i.id === currentIdentityId);
  const [state, action, pending] = useActionState(linkAccountAction.bind(null, accountId), IDLE);
  return (
    <form action={action} className="space-y-3">
      <SelectField label="Belongs to" name="identityId" defaultValue={currentIdentityId ?? ""} hint="People, external people and machine identities">
        <option value="">Choose an identity…</option>
        {showCurrent ? <option value={currentIdentityId}>{currentIdentityName ?? "The current identity"}</option> : null}
        {identities.map((i) => (
          <option key={i.id} value={i.id}>
            {i.label}
          </option>
        ))}
      </SelectField>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" name="intent" value="link" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {pending ? "Saving…" : "Link account"}
        </Button>
        {currentIdentityId ? (
          <Button type="submit" name="intent" value="unlink" variant="outline" disabled={pending}>
            Unlink
          </Button>
        ) : null}
        <Result state={state} />
      </div>
    </form>
  );
}

export function ReconcileAccountsForm({ applicationId, disabledReason }: { applicationId: string; disabledReason: string | null }) {
  const [state, action, pending] = useActionState(reconcileAccountsAction.bind(null, applicationId), IDLE);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <Button type="submit" size="sm" disabled={pending || Boolean(disabledReason)}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        {pending ? "Reconciling…" : "Reconcile accounts"}
      </Button>
      {disabledReason && state.status === "idle" ? <span className="text-xs text-muted-foreground">{disabledReason}</span> : <Result state={state} />}
    </form>
  );
}
