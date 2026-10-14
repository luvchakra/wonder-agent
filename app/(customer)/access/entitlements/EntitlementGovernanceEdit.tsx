"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/modules/ui/Button";

/**
 * ACCESS-P0-33 — a person sets an entitlement's type, and whether it can be
 * requested or is SOX-relevant, folded under the row. Saved as a person's
 * decision (classification rules never override it); the server's message
 * is shown as it is.
 */
export function EntitlementGovernanceEdit({
  id,
  name,
  entitlementType,
  requestable,
  soxRelevant,
}: {
  id: string;
  name: string;
  entitlementType: string | null;
  requestable: boolean;
  soxRelevant: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState({ entitlementType: entitlementType ?? "", requestable, soxRelevant });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-xs text-muted-foreground">Edit</summary>
      <form
        className="mt-1 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await fetch(`/api/v1/access/entitlements/${id}/governance`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(v) });
            const json = await res.json().catch(() => ({}));
            setError(!res.ok || !json.ok ? (json.error?.message ?? "It could not be saved") : null);
            router.refresh();
          });
        }}
      >
        <label>
          <span className="block text-xs text-muted-foreground">Type</span>
          <input
            value={v.entitlementType}
            onChange={(e) => setV({ ...v, entitlementType: e.target.value })}
            maxLength={100}
            aria-label={`${name}: type`}
            className="block w-32 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-foreground">
          <input type="checkbox" checked={v.requestable} onChange={(e) => setV({ ...v, requestable: e.target.checked })} aria-label={`${name}: requestable`} />
          Requestable
        </label>
        <label className="flex items-center gap-1.5 text-sm text-foreground">
          <input type="checkbox" checked={v.soxRelevant} onChange={(e) => setV({ ...v, soxRelevant: e.target.checked })} aria-label={`${name}: SOX-relevant`} />
          SOX-relevant
        </label>
        <Button type="submit" size="sm" variant="outline" disabled={pending} aria-label={`Save ${name}`}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          Save
        </Button>
        {error ? (
          <p role="alert" className="w-full text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </form>
    </details>
  );
}
