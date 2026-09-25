"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { reviewOwnershipAction } from "@/app/actions/agents";
import { Button } from "@/modules/ui";

/**
 * IDENTITY-P0-13 — the periodic ownership review: an owner confirms the
 * agent's owners are still right. Shows the real server result, including
 * why it was refused (a missing required owner, an expired delegation).
 */
export function ReviewOwnershipButton({ agentId }: { agentId: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const router = useRouter();
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await reviewOwnershipAction(agentId);
            setResult(r);
            if (r.ok) router.refresh();
          })
        }
      >
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        {pending ? "Confirming…" : "Confirm ownership"}
      </Button>
      {result ? (
        <span role="status" className={`text-xs ${result.ok ? "text-success" : "text-destructive"}`}>
          {result.message}
        </span>
      ) : null}
    </span>
  );
}
