"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/modules/ui/Button";

/**
 * ACCESS-P0-42 — who does this application's manual fulfilment tasks: a
 * person or group for the application, and optionally for one entitlement
 * type. Without one, tasks go to the technical owner, then the business
 * owner. Saved through /api/v1/access/applications/:id/fulfilment-assignments
 * (access.manage); the server's own message is shown.
 */

export type AssignmentView = { id: string; entitlementType: string | null; identityName: string | null; groupName: string | null };
const field = "block w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";

async function call(url: string, method: "POST" | "DELETE", body?: unknown): Promise<string | null> {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return !res.ok || !json.ok ? (json.error?.message ?? "It could not be saved") : null;
}

export function FulfilmentAssignments({
  applicationId,
  assignments,
  types,
  choices,
  canManage,
}: {
  applicationId: string;
  assignments: AssignmentView[];
  types: string[];
  choices: { value: string; label: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const url = `/api/v1/access/applications/${applicationId}/fulfilment-assignments`;
  const who = (a: AssignmentView) => (a.groupName ? `${a.groupName} (group)` : (a.identityName ?? "—"));
  const fallback = !assignments.some((a) => !a.entitlementType);
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-muted-foreground">Fulfilled by</summary>
      <ul className="mt-2 space-y-1">
        {fallback ? <li className="text-xs text-muted-foreground">Application: its technical owner, then its business owner</li> : null}
        {assignments.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-foreground">
              <span className="text-xs text-muted-foreground">{a.entitlementType ? `Type ${a.entitlementType}: ` : "Application: "}</span>
              {who(a)}
            </span>
            {canManage ? (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const e = await call(`${url}?assignmentId=${a.id}`, "DELETE");
                    setError(e);
                    if (!e) router.refresh();
                  })
                }
              >
                Remove
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {canManage ? (
        <form
          className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const [kind, id] = String(f.get("assignee") ?? "").split(":");
            start(async () => {
              const err = await call(url, "POST", {
                entitlementType: String(f.get("entitlementType") ?? "") || null,
                identityId: kind === "identity" ? id : undefined,
                groupId: kind === "group" ? id : undefined,
              });
              setError(err);
              if (!err) router.refresh();
            });
          }}
        >
          <select name="entitlementType" aria-label="For" className={field} defaultValue="">
            <option value="">The whole application</option>
            {types.map((t) => (
              <option key={t} value={t}>
                Type {t}
              </option>
            ))}
          </select>
          <select name="assignee" aria-label="Fulfilled by" required className={field} defaultValue="">
            <option value="" disabled>
              Person or group
            </option>
            {choices.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Set
          </Button>
        </form>
      ) : null}
      {error ? (
        <p role="status" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </details>
  );
}
