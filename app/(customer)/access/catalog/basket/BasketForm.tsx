"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Badge, Button, RequestNumberBarcode, SelectField, TextareaField } from "@/modules/ui";

/**
 * ACCESS-P0-38 — the basket form. "Same access as" asks the server which of
 * that person's requestable access the first person chosen lacks (it sends
 * nothing). Sending shows each request's real outcome (§17.5).
 */

type Result = { subjectIdentityId: string; line: number; ok: boolean; requestId?: string; requestNumber?: string | null; status?: string; duplicate?: boolean; code?: string; message?: string };
type Sent = { basketId: string; results: Result[]; summary: { created: number; existing: number; refused: number } };

async function call<T>(url: string, init?: RequestInit): Promise<{ data?: T; error?: string }> {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => ({}));
  return !res.ok || !json.ok ? { error: json.error?.message ?? "It could not be done" } : { data: json.data as T };
}

type Draft = { id: string; name: string; payload: { subjectIdentityIds: string[]; items: string[]; justification: string } };

export function BasketForm({ people, items, drafts = [] }: { people: { id: string; label: string }[]; items: { value: string; label: string }[]; drafts?: Draft[] }) {
  const [subjects, setSubjects] = useState<string[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [why, setWhy] = useState("");
  // ACCESS-P0-38 part 2: a saved basket, to finish and send later.
  const [draftId, setDraftId] = useState("");
  const [draftName, setDraftName] = useState("");
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const [model, setModel] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const [pending, start] = useTransition();
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const label = (id: string) => people.find((p) => p.id === id)?.label ?? "Someone";

  if (sent) {
    const created = sent.results.filter((r) => r.ok && !r.duplicate && r.requestNumber);
    return (
      <div className="space-y-3">
        {created.length === 1 ? <RequestNumberBarcode number={created[0].requestNumber!} /> : null}
        <p role="status" className="text-sm text-foreground">
          {sent.summary.created} sent{sent.summary.existing ? `, ${sent.summary.existing} already open` : ""}
          {sent.summary.refused ? `, ${sent.summary.refused} refused` : ""}.
        </p>
        <ul className="divide-y divide-border text-sm">
          {sent.results.map((r) => (
            <li key={`${r.subjectIdentityId}-${r.line}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                {r.requestNumber ? <span className="font-mono text-xs text-muted-foreground">{r.requestNumber} · </span> : null}
                {label(r.subjectIdentityId)} · {items.find((i) => i.value === chosen[r.line])?.label ?? `Item ${r.line + 1}`}
                {!r.ok && r.message ? <span className="block text-xs text-destructive">{r.message}</span> : null}
              </span>
              {r.ok && r.requestId ? (
                <Link href={`/access/requests/${r.requestId}`} className="text-xs text-primary hover:underline">
                  <Badge tone={r.duplicate ? "neutral" : r.status === "approved" ? "success" : "warning"}>
                    {r.duplicate ? "Already open" : r.status === "approved" ? "Approved" : "Waiting for approval"}
                  </Badge>
                </Link>
              ) : (
                <Badge tone="danger">Refused</Badge>
              )}
            </li>
          ))}
        </ul>
        <Link href="/access/requests?view=mine" className="text-sm text-primary hover:underline">
          My requests
        </Link>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        start(async () => {
          const r = await call<Sent>("/api/v1/access/requests/basket", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              subjectIdentityIds: subjects,
              lines: chosen.map((v) => {
                const [applicationId, entitlementId] = v.split("|");
                return { applicationId, entitlementId: entitlementId || null, durationDays: f.get("durationDays") || null };
              }),
              justification: why,
            }),
          });
          if (r.error) setError(r.error);
          else {
            setSent(r.data!);
            // A sent draft is done with.
            if (draftId) await call(`/api/v1/access/requests/drafts/${draftId}`, { method: "DELETE" });
          }
        });
      }}
    >
      {drafts.length ? (
        <SelectField
          label="Start from a draft"
          name="draft"
          value={draftId}
          className="max-w-xs"
          onChange={(e) => {
            const d = drafts.find((x) => x.id === e.target.value);
            setDraftId(e.target.value);
            setDraftName(d?.name ?? "");
            setSubjects(d ? d.payload.subjectIdentityIds.filter((id) => people.some((p) => p.id === id)) : []);
            setChosen(d ? d.payload.items.filter((v) => items.some((i) => i.value === v)) : []);
            setWhy(d?.payload.justification ?? "");
          }}
        >
          <option value="">New basket</option>
          {drafts.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </SelectField>
      ) : null}

      <fieldset>
        <legend className="text-sm font-medium text-foreground">For</legend>
        <div className="mt-2 grid max-h-48 grid-cols-1 gap-1 overflow-y-auto rounded-md border border-border p-2 sm:grid-cols-2">
          {people.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={subjects.includes(p.id)} onChange={() => setSubjects((s) => toggle(s, p.id))} className="size-4 accent-primary" />
              {p.label}
            </label>
          ))}
        </div>
      </fieldset>

      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">Same access as…</summary>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <SelectField label="Person" name="model" value={model} onChange={(e) => setModel(e.target.value)} className="max-w-xs">
            <option value="">Choose</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </SelectField>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!model || subjects.length === 0 || pending}
            onClick={() =>
              start(async () => {
                const r = await call<{ lines: { applicationId: string; entitlementId: string }[]; skipped: { entitlementName: string; reason: string }[] }>(
                  `/api/v1/access/requests/model-after?${new URLSearchParams({ subject: subjects[0], model }).toString()}`,
                );
                if (r.error) return setError(r.error);
                const add = r.data!.lines.map((l) => `${l.applicationId}|${l.entitlementId}`).filter((v) => items.some((i) => i.value === v));
                setChosen((c) => [...new Set([...c, ...add])]);
                setError(null);
                setNote(`${add.length} added${r.data!.skipped.length ? `; left out: ${r.data!.skipped.map((s) => `${s.entitlementName} (${s.reason})`).join(", ")}` : ""}.`);
              })
            }
          >
            Fill
          </Button>
        </div>
        {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
      </details>

      <fieldset>
        <legend className="text-sm font-medium text-foreground">What</legend>
        <div className="mt-2 grid max-h-64 grid-cols-1 gap-1 overflow-y-auto rounded-md border border-border p-2">
          {items.map((i) => (
            <label key={i.value} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={chosen.includes(i.value)} onChange={() => setChosen((c) => toggle(c, i.value))} className="size-4 accent-primary" />
              {i.label}
            </label>
          ))}
        </div>
      </fieldset>

      <SelectField label="For how long" name="durationDays" defaultValue="" className="max-w-xs">
        <option value="">As each policy allows</option>
        {[7, 30, 90, 180, 365].map((d) => (
          <option key={d} value={d}>
            {d} days
          </option>
        ))}
      </SelectField>
      <TextareaField label="Why" name="justification" rows={2} maxLength={2000} value={why} onChange={(e) => setWhy(e.target.value)} />

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || subjects.length === 0 || chosen.length === 0}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {pending ? "Sending…" : `Send ${subjects.length * chosen.length || ""} request${subjects.length * chosen.length === 1 ? "" : "s"}`}
        </Button>
        {error ? (
          <p role="status" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">Save as draft</summary>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input aria-label="Draft name" value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="Name" maxLength={200} className="h-8 w-56 rounded-md border border-input bg-background px-2 text-sm text-foreground" />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending || !draftName.trim()}
            onClick={() =>
              start(async () => {
                const body = JSON.stringify({ name: draftName, payload: { subjectIdentityIds: subjects, items: chosen, justification: why } });
                const r = await call<{ id: string }>(draftId ? `/api/v1/access/requests/drafts/${draftId}` : "/api/v1/access/requests/drafts", {
                  method: draftId ? "PUT" : "POST",
                  headers: { "content-type": "application/json" },
                  body,
                });
                if (r.error) return setError(r.error);
                setDraftId(r.data!.id);
                setError(null);
                setDraftNote("Draft saved. Nothing was sent.");
              })
            }
          >
            Save draft
          </Button>
          {draftNote ? (
            <span role="status" className="text-xs text-success">
              {draftNote}
            </span>
          ) : null}
        </div>
      </details>
    </form>
  );
}
