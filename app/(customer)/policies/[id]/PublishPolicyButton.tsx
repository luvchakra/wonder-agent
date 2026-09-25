"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { publishPolicyAction } from "@/app/actions/access";
import { Button } from "@/modules/ui";

/** ACCESS-P0-12 — publishes a draft; shows the real result, never an optimistic one. */
export function PublishPolicyButton({ policyId }: { policyId: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const router = useRouter();
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await publishPolicyAction(policyId);
            setResult(r);
            if (r.ok) router.refresh();
          })
        }
      >
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        {pending ? "Publishing…" : "Publish"}
      </Button>
      {result ? (
        <span role="status" className={`text-xs ${result.ok ? "text-success" : "text-destructive"}`}>
          {result.message}
        </span>
      ) : null}
    </span>
  );
}
