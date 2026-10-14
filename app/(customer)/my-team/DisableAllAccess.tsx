"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/modules/ui/Button";

/**
 * IDENTITY-P0-18 (finish): stop all of a direct report's access at once,
 * folded under the row. Needs a reason; the server checks that the viewer
 * is their manager (or an identity administrator) and shows its own result.
 */
export function DisableAllAccess({ identityId, name }: { identityId: string; name: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  const field = "block w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";

  if (done)
    return (
      <p role="status" className="text-sm text-success">
        {name} is disabled. Removing their access has started; each removal is tracked in Requests.
      </p>
    );
  return (
    <details>
      <summary className="cursor-pointer text-xs text-muted-foreground">Disable all access</summary>
      <form
        className="mt-2 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await fetch(`/api/v1/identities/${identityId}/disable-access`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) });
            const body = await res.json().catch(() => ({}));
            if (!res.ok || !body.ok) {
              setError(body.error?.message ?? "It could not be done");
              return;
            }
            setError(null);
            setDone(true);
            router.refresh();
          });
        }}
      >
        <label className="min-w-[14rem] flex-1">
          <span className="block text-xs font-medium text-muted-foreground">Reason</span>
          <input required maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} className={field} aria-label={`Reason to disable ${name}`} />
        </label>
        <Button type="submit" size="sm" variant="destructive" disabled={pending || !reason.trim()}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          Disable {name}
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
