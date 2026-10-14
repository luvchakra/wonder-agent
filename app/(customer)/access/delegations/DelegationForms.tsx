"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button, SelectField, TextField } from "@/modules/ui";

/** ACCESS-P0-23 — the delegation form and its revoke button; the server validates and its message is shown. */

async function call(url: string, body?: unknown): Promise<string | null> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return !res.ok || !json.ok ? (json.error?.message ?? "It could not be saved") : null;
}

export function DelegationForm({ people, everyone }: { people: { id: string; label: string }[]; everyone: { id: string; label: string }[] | null }) {
  const router = useRouter();
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
          if (!err) router.refresh();
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
