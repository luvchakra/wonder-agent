"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/modules/ui/Button";
import type { ApplicationEntitlementType } from "@/lib/shared/types/access-governance";

/**
 * ACCESS-P0-33 — an application's entitlement types, on the application's
 * Entitlements tab: how each is offered in a request, whether it is
 * certifiable, its default and maximum duration. Saved through
 * /api/v1/access/applications/:id/entitlement-types (access.manage); the
 * server validates and its own message is shown.
 */

const MODE_LABEL: Record<ApplicationEntitlementType["requestMode"], string> = {
  single: "One at a time",
  multiple: "Several at once",
  free_text: "Free text",
  not_requestable: "Shown, not requestable",
};
const field = "block w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";

async function save(url: string, method: "POST" | "PATCH", body: unknown): Promise<string | null> {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return !res.ok || !json.ok ? (json.error?.message ?? "It could not be saved") : null;
}

function TypeRow({ applicationId, type, canManage }: { applicationId: string; type: ApplicationEntitlementType; canManage: boolean }) {
  const router = useRouter();
  const [v, setV] = useState({ requestMode: type.requestMode, certifiable: type.certifiable, defaultDurationDays: type.defaultDurationDays ?? "", maxDurationDays: type.maxDurationDays ?? "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <li className="space-y-2 py-2">
      <p className="text-sm">
        <span className="font-medium text-foreground">{type.name}</span>
        <span className="text-xs text-muted-foreground">
          {" "}
          · {type.entitlementCount ?? 0} entitlements · {type.origin === "connector" ? "from the connector" : "added by hand"}
        </span>
      </p>
      {canManage ? (
        <form
          className="flex flex-wrap items-end gap-x-3 gap-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setError(await save(`/api/v1/access/applications/${applicationId}/entitlement-types/${type.id}`, "PATCH", v));
              router.refresh();
            });
          }}
        >
          <label className="w-full sm:w-48">
            <span className="block text-xs text-muted-foreground">Requested as</span>
            <select aria-label={`${type.name}: requested as`} value={v.requestMode} onChange={(e) => setV({ ...v, requestMode: e.target.value as typeof v.requestMode })} className={field}>
              {Object.entries(MODE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex h-8 items-center gap-1.5 text-sm text-foreground">
            <input type="checkbox" checked={v.certifiable} onChange={(e) => setV({ ...v, certifiable: e.target.checked })} aria-label={`${type.name}: certifiable`} />
            Certifiable
          </label>
          <label className="w-24">
            <span className="block text-xs text-muted-foreground">Default days</span>
            <input
              aria-label={`${type.name}: default days`}
              inputMode="numeric"
              value={v.defaultDurationDays}
              onChange={(e) => setV({ ...v, defaultDurationDays: e.target.value })}
              className={field}
            />
          </label>
          <label className="w-24">
            <span className="block text-xs text-muted-foreground">Max days</span>
            <input aria-label={`${type.name}: max days`} inputMode="numeric" value={v.maxDurationDays} onChange={(e) => setV({ ...v, maxDurationDays: e.target.value })} className={field} />
          </label>
          <Button type="submit" size="sm" variant="outline" disabled={pending} aria-label={`Save ${type.name}`}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Save
          </Button>
          {error ? (
            <p role="alert" className="w-full text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </form>
      ) : (
        <p className="text-xs text-muted-foreground">
          {MODE_LABEL[type.requestMode]}
          {type.certifiable ? "" : " · not certified"}
          {type.maxDurationDays ? ` · at most ${type.maxDurationDays} days` : ""}
        </p>
      )}
    </li>
  );
}

export function EntitlementTypes({ applicationId, types, canManage }: { applicationId: string; types: ApplicationEntitlementType[]; canManage: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <section aria-labelledby="entitlement-types">
      <h2 id="entitlement-types" className="text-sm font-semibold text-foreground">
        Entitlement types ({types.length})
      </h2>
      {types.length ? (
        <ul className="mt-2 divide-y divide-border">
          {types.map((t) => (
            <TypeRow key={t.id} applicationId={applicationId} type={t} canManage={canManage} />
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">No types yet. They arrive with the connector&apos;s entitlements, or can be added here.</p>
      )}
      {canManage ? (
        <form
          className="mt-3 flex max-w-md flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const err = await save(`/api/v1/access/applications/${applicationId}/entitlement-types`, "POST", { name });
              setError(err);
              if (!err) setName("");
              router.refresh();
            });
          }}
        >
          <label className="flex-1">
            <span className="block text-xs text-muted-foreground">New type</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} className={field} aria-label="New entitlement type" />
          </label>
          <Button type="submit" size="sm" variant="outline" disabled={pending || !name.trim()}>
            Add type
          </Button>
          {error ? (
            <p role="alert" className="w-full text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
