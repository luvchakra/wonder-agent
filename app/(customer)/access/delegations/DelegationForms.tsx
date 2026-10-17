"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button, SelectField, TextField, useCloseCreateDialog } from "@/modules/ui";

/** ACCESS-P0-23 — the delegation form and its revoke button; the server validates and its message is shown. */

async function call(url: string, body?: unknown): Promise<string | null> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return !res.ok || !json.ok ? (json.error?.message ?? "It could not be saved") : null;
}

export function DelegationForm({ people, everyone, canDelegateAdministration = false }: { people: { id: string; label: string }[]; everyone: { id: string; label: string }[] | null; canDelegateAdministration?: boolean }) {
  const router = useRouter();
  const closeDialog = useCloseCreateDialog();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        start(async () => {
          const until = String(f.get("endsAt") ?? "");
          const err = await call("/api/v1/access/delegations", {
            delegatorUserId: f.get("delegatorUserId") || undefined,
            delegateUserId: f.get("delegateUserId"),
            scope: f.get("scope"),
            endsAt: until ? new Date(`${until}T23:59:59`).toISOString() : "",
            reason: f.get("reason"),
          });
          setError(err);
          if (!err) {
            router.refresh();
            closeDialog();
          }
        });
      }}
    >
      {everyone ? (
        // An access manager may set one for someone else.
        <SelectField label="Whose" name="delegatorUserId" defaultValue="">
          <option value="">Mine</option>
          {everyone.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </SelectField>
      ) : null}
      <SelectField label="What" name="scope" defaultValue="approvals">
        <option value="approvals">Deciding approvals</option>
        <option value="requests">Asking for access</option>
        {/* Part 3: their roles, as copies until the end date; only for someone who manages roles. */}
        {canDelegateAdministration ? <option value="administration">Administration (their roles)</option> : null}
      </SelectField>
      <SelectField label="To" name="delegateUserId" required defaultValue="">
        <option value="" disabled>
          Choose
        </option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </SelectField>
      <TextField label="Until" name="endsAt" type="date" required />
      <TextField label="Why (optional)" name="reason" maxLength={500} />
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          Delegate
        </Button>
        {error ? (
          <p role="status" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </form>
  );
}

export function RevokeDelegation({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const err = await call(`/api/v1/access/delegations/${id}/revoke`);
            setError(err);
            if (!err) router.refresh();
          })
        }
      >
        End
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </>
  );
}

/**
 * ACCESS-P0-23 part 4 — let an agent act for you (or for an agent you own),
 * for named actions. It takes effect once an owner of the agent approves.
 */
export function AgentDelegationForm({ agents, ownAgents }: { agents: { id: string; label: string }[]; ownAgents: { id: string; label: string }[] }) {
  const router = useRouter();
  const closeDialog = useCloseCreateDialog();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      aria-label="Let an agent act for you"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const from = String(f.get("from") ?? "");
        start(async () => {
          const err = await call("/api/v1/access/agent-delegations", {
            delegatorKind: from ? "agent" : "user",
            delegatorAgentId: from || undefined,
            delegateAgentId: f.get("delegateAgentId"),
            actions: String(f.get("actions") ?? ""),
            applications: String(f.get("applications") ?? ""),
            days: Number(f.get("days") ?? 30),
            reason: f.get("reason"),
          });
          setError(err);
          if (!err) {
            router.refresh();
            closeDialog();
          }
        });
      }}
    >
      {ownAgents.length ? (
        <SelectField label="For" name="from" defaultValue="">
          <option value="">Me</option>
          {ownAgents.map((a) => (
            <option key={a.id} value={a.id}>
              Agent {a.label}
            </option>
          ))}
        </SelectField>
      ) : null}
      <SelectField label="Agent that acts" name="delegateAgentId" required defaultValue="">
        <option value="" disabled>
          Choose
        </option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
          </option>
        ))}
      </SelectField>
      <TextField label="Actions" name="actions" required placeholder="read, report" hint="Comma-separated, as the agent names them" />
      <TextField label="Applications (optional)" name="applications" placeholder="Snowflake" hint="Blank: any its contract approves" />
      <TextField label="Days" name="days" type="number" min={1} max={180} defaultValue="30" required />
      <TextField label="Why" name="reason" required maxLength={1000} />
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          Ask the agent&apos;s owner
        </Button>
        {error ? (
          <p role="status" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </form>
  );
}

export function EndAgentDelegation({ id, pendingApproval }: { id: string; pendingApproval: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const err = await call(`/api/v1/access/agent-delegations/${id}/revoke`);
            setError(err);
            if (!err) router.refresh();
          })
        }
      >
        {pendingApproval ? "Withdraw" : "End"}
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </>
  );
}

/** An agent owner's decision; rejecting needs a reason. */
export function DecideAgentDelegation({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const decide = (decision: "approve" | "reject") =>
    start(async () => {
      const err = await call(`/api/v1/access/agent-delegations/${id}/decision`, { decision, note });
      setError(err);
      if (!err) router.refresh();
    });
  return (
    <div className="flex flex-wrap items-end gap-2">
      <TextField label="Note" name="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Needed to reject" />
      <Button size="sm" disabled={pending} onClick={() => decide("approve")}>
        Approve
      </Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => decide("reject")}>
        Reject
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
