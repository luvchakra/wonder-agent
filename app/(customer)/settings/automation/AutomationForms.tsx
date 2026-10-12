"use client";

import { useActionState } from "react";
import {
  approveAutomationCredentialAction,
  approveExtensionAction,
  createAutomationCredentialAction,
  credentialRoleAction,
  requestExtensionAction,
  revokeAutomationCredentialAction,
  rotateAutomationCredentialAction,
  type AutomationActionState,
} from "@/app/actions/automation";
import type { AutomationCredential } from "@/lib/security/automationCredentials";
import { PendingSubmitButton, fieldInputClass, fieldLabelClass } from "@/modules/ui";
import { cn } from "@/lib/utils";

/**
 * FOUNDATION-P0-31 — the Automation credentials forms. Each waits for the
 * server's answer and shows it as given; a secret is shown once, here,
 * and never again.
 */

const initial: AutomationActionState = { ok: false, message: null };
type Role = { name: string; displayName: string };

function Result({ state }: { state: AutomationActionState }) {
  if (!state.message) return null;
  return (
    <div
      role={state.ok ? "status" : "alert"}
      className={cn("rounded-md border px-3 py-2 text-sm", state.ok ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive/10 text-destructive")}
    >
      {state.message}
      {state.secret ? (
        <code data-testid="automation-secret" className="mt-2 block select-all break-all rounded bg-muted px-2 py-1 font-mono text-xs text-foreground">
          {state.secret}
        </code>
      ) : null}
    </div>
  );
}

export function CreateCredentialForm({ identities, roles }: { identities: { id: string; name: string }[]; roles: Role[] }) {
  const [state, action] = useActionState(createAutomationCredentialAction, initial);
  if (!identities.length) return <p className="text-sm text-muted-foreground">Add an application identity first (Identities → New identity, type Application).</p>;
  return (
    <form action={action} className="space-y-3">
      <div>
        <label htmlFor="ac-name" className={fieldLabelClass}>
          Name
        </label>
        <input id="ac-name" name="name" required maxLength={120} className={fieldInputClass} />
      </div>
      <div>
        <label htmlFor="ac-identity" className={fieldLabelClass}>
          Application identity
        </label>
        <select id="ac-identity" name="identityId" required className={fieldInputClass}>
          {identities.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="ac-role" className={fieldLabelClass}>
          Role
        </label>
        <select id="ac-role" name="roles" required className={fieldInputClass} defaultValue={roles.find((r) => r.name === "CONFIGURATION_ADMIN")?.name}>
          {roles.map((r) => (
            <option key={r.name} value={r.name}>
              {r.displayName}
            </option>
          ))}
        </select>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">Expiry and limits</summary>
        <div className="mt-2 space-y-3">
          <div>
            <label htmlFor="ac-days" className={fieldLabelClass}>
              Expires after (days)
            </label>
            <input id="ac-days" name="expiresInDays" type="number" min={1} max={365} defaultValue={90} className={fieldInputClass} />
          </div>
          <div>
            <label htmlFor="ac-cidrs" className={fieldLabelClass}>
              Allowed addresses <span className="font-normal text-muted-foreground">(optional, CIDR)</span>
            </label>
            <input id="ac-cidrs" name="allowedCidrs" placeholder="203.0.113.0/24" className={fieldInputClass} />
          </div>
          <div>
            <label htmlFor="ac-rate" className={fieldLabelClass}>
              Calls a minute
            </label>
            <input id="ac-rate" name="rateLimitPerMinute" type="number" min={1} max={10000} defaultValue={120} className={fieldInputClass} />
          </div>
        </div>
      </details>
      <Result state={state} />
      <PendingSubmitButton size="sm" pendingLabel="Creating…">
        Create credential
      </PendingSubmitButton>
    </form>
  );
}

function IdForm({ id, action, label, pending, variant, children }: { id: string; action: (p: AutomationActionState, f: FormData) => Promise<AutomationActionState>; label: string; pending: string; variant?: "outline" | "destructive"; children?: React.ReactNode }) {
  const [state, run] = useActionState(action, initial);
  return (
    <form action={run} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      {children}
      <Result state={state} />
      <PendingSubmitButton size="sm" variant={variant} pendingLabel={pending}>
        {label}
      </PendingSubmitButton>
    </form>
  );
}

/** The row's one action: approving what someone else asked for. */
export function PrimaryCredentialAction({ credential, viewerId }: { credential: AutomationCredential; viewerId: string }) {
  if (credential.state === "pending" && credential.createdBy.id !== viewerId) return <IdForm id={credential.id} action={approveAutomationCredentialAction} label="Approve" pending="Approving…" />;
  if (credential.state !== "revoked" && credential.requestedExpiresAt && credential.extensionRequestedBy?.id !== viewerId) {
    return <IdForm id={credential.id} action={approveExtensionAction} label="Approve extension" pending="Approving…" />;
  }
  return null;
}

/** Everything else, folded: roles, extend, rotate, revoke. */
export function CredentialManage({ credential, roles }: { credential: AutomationCredential; roles: Role[] }) {
  if (credential.state === "revoked") return null;
  const id = credential.id;
  return (
    <details className="mt-1 text-sm">
      <summary className="cursor-pointer text-xs text-muted-foreground">Manage</summary>
      <div className="mt-2 grid gap-4 sm:grid-cols-2">
        <IdForm id={id} action={credentialRoleAction} label="Apply" pending="Saving…" variant="outline">
          <label className={fieldLabelClass}>
            Role
            <select name="role" className={fieldInputClass}>
              {roles.map((r) => (
                <option key={r.name} value={r.name}>
                  {r.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" name="op" value="remove" /> Remove instead of give
          </label>
        </IdForm>
        {credential.state === "active" || credential.state === "expired" ? (
          <IdForm id={id} action={requestExtensionAction} label="Request extension" pending="Requesting…" variant="outline">
            <label className={fieldLabelClass}>
              New expiry, days from today
              <input name="days" type="number" min={1} max={365} defaultValue={90} className={fieldInputClass} />
            </label>
          </IdForm>
        ) : null}
        <IdForm id={id} action={rotateAutomationCredentialAction} label="Rotate secret" pending="Rotating…" variant="outline" />
        <IdForm id={id} action={revokeAutomationCredentialAction} label="Revoke" pending="Revoking…" variant="destructive">
          <label className={fieldLabelClass}>
            Reason
            <input name="reason" required maxLength={500} className={fieldInputClass} />
          </label>
        </IdForm>
      </div>
    </details>
  );
}
