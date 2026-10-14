"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/modules/ui/Button";

/**
 * WID-H04 (owner decision 2026-10-12): closes a rogue-access finding
 * without removing the access, folded under the row's main action. An
 * accepted exception ends on a date at most 90 days away and the finding
 * reopens then; a false positive closes it. RISK-P0-13 adds approving the
 * access afterwards, or recognizing it as legacy access, optionally until a
 * date (it is removed then), or adding it to a package the identity holds
 * (offered only when there is one). Each needs a reason; the server refuses
 * the account's owner and shows its own result.
 */
export function CloseRogueFinding({ findingId, packages = [] }: { findingId: string; packages?: { id: string; name: string }[] }) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<"authorize" | "legacy" | "package" | "exception" | "false_positive">("authorize");
  const approving = outcome === "authorize" || outcome === "legacy" || outcome === "package";
  const [packageId, setPackageId] = useState(packages[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const field = "block rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";

  return (
    <details className="w-full">
      <summary className="cursor-pointer text-xs text-muted-foreground">Other outcomes</summary>
      <form
        className="mt-2 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = approving
              ? await fetch(`/api/v1/findings/${findingId}/authorize`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(outcome === "package" ? { kind: outcome, reason, packageId } : { kind: outcome, reason, until: until || undefined }),
                })
              : await fetch(`/api/v1/findings/${findingId}/decision`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ outcome, reason, until: outcome === "exception" ? until : undefined }),
                });
            const body = await res.json().catch(() => ({}));
            if (!res.ok || !body.ok) {
              setError(body.error?.message ?? "It could not be saved");
              return;
            }
            setError(null);
            router.refresh();
          });
        }}
      >
        <label>
          <span className="block text-xs font-medium text-muted-foreground">Outcome</span>
          <select value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)} className={field}>
            <option value="authorize">Approve it afterwards</option>
            <option value="legacy">Recognize as legacy access</option>
            {packages.length ? <option value="package">Add to a package they hold</option> : null}
            <option value="exception">Accept as an exception</option>
            <option value="false_positive">Not rogue (false positive)</option>
          </select>
        </label>
        {outcome === "exception" ? (
          <label>
            <span className="block text-xs font-medium text-muted-foreground">Until (90 days at most)</span>
            <input type="date" required value={until} onChange={(e) => setUntil(e.target.value)} className={field} />
          </label>
        ) : outcome === "package" ? (
          <label>
            <span className="block text-xs font-medium text-muted-foreground">Package</span>
            <select required value={packageId} onChange={(e) => setPackageId(e.target.value)} className={field}>
              {packages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        ) : approving ? (
          <label>
            <span className="block text-xs font-medium text-muted-foreground">Until (optional; removed then)</span>
            <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className={field} />
          </label>
        ) : null}
        <label className="min-w-[14rem] flex-1">
          <span className="block text-xs font-medium text-muted-foreground">Reason</span>
          <input required maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} className={`${field} w-full`} />
        </label>
        <Button type="submit" size="sm" variant="secondary" disabled={pending || !reason.trim()}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          Save
        </Button>
        {error ? (
          <p role="alert" className="w-full text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </form>
    </details>
  );
}
