"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { linkAccountAction, reconcileAccessAction, reconcileAccountsAction, type AccessReconcileState, type AccountFormState } from "@/app/actions/accounts";
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

/** One line per side, e.g. "Entitlements: 3 added, 1 removed". Zero counts are left out. */
function countLine(label: string, counts: Record<string, number> | undefined): string {
  const parts = Object.entries(counts ?? {})
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${k}`);
  return `${label}: ${parts.length ? parts.join(", ") : "no change"}`;
}

/**
 * ACCESS-P0-27 — preview what the connector's entitlements and access would
 * change, then apply exactly that preview.
 */
export function ReconcileAccessForm({ applicationId, disabledReason }: { applicationId: string; disabledReason: string | null }) {
  const [state, action, pending] = useActionState(reconcileAccessAction.bind(null, applicationId), { status: "idle" } as AccessReconcileState);
  const run = state.status === "previewed" || state.status === "applied" ? state.run : null;
  const counts = run?.counts as { entitlements?: Record<string, number>; grants?: Record<string, number> } | undefined;
  const samples = run?.samples as { entitlements?: Record<string, string[]>; grants?: Record<string, string[]> } | undefined;
  const examples = [...Object.entries(samples?.entitlements ?? {}).map(([k, v]) => [`Entitlements ${k}`, v] as const), ...Object.entries(samples?.grants ?? {}).map(([k, v]) => [`Access ${k}`, v] as const)].filter(
    ([, v]) => v.length > 0,
  );
  return (
    <form action={action} className="space-y-2">
      {state.status === "previewed" ? <input type="hidden" name="previewRunId" value={state.run.id} /> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" variant={state.status === "previewed" ? "default" : "outline"} disabled={pending || Boolean(disabledReason)}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {pending ? "Working…" : state.status === "previewed" ? "Apply these changes" : "Preview access from the connector"}
        </Button>
        {disabledReason && state.status === "idle" ? <span className="text-xs text-muted-foreground">{disabledReason}</span> : null}
        {state.status === "error" ? <span className="text-xs text-destructive">{state.message}</span> : null}
      </div>
      {run ? (
        <div role="status" className="space-y-1 text-xs text-muted-foreground">
          <p className={state.status === "applied" ? "text-success" : "text-foreground"}>{state.status === "applied" ? "Applied." : "Preview: nothing has changed yet."}</p>
          <p>{countLine("Entitlements", counts?.entitlements)}</p>
          <p>{countLine("Access", counts?.grants)}</p>
          {examples.length ? (
            <details>
              <summary className="cursor-pointer">Examples</summary>
              <ul className="mt-1 space-y-0.5">
                {examples.map(([label, values]) => (
                  <li key={label}>
                    {label}: {values.join("; ")}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
