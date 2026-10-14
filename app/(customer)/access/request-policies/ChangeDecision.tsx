"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/modules/ui";

/** ACCESS-P0-35 — approve (apply) or reject a waiting change; the server checks who may and says why not. */
export function ChangeDecision({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const decide = (decision: "approved" | "rejected") =>
    start(async () => {
      const res = await fetch(`/api/v1/access/governance-changes/${id}/decision`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }) });
      const json = await res.json().catch(() => ({}));
      const err = !res.ok || !json.ok ? (json.error?.message ?? "It could not be decided") : null;
      setError(err);
      if (!err) router.refresh();
    });
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={pending} onClick={() => decide("approved")}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        Approve
      </Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => decide("rejected")}>
        Reject
      </Button>
      {error ? (
        <span role="status" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </span>
  );
}
