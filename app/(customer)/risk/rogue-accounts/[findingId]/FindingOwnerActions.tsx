"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/modules/ui/Button";
import { fieldInputClass } from "@/modules/ui";

/**
 * RISK-P0-13: who works on a rogue-access finding, and escalating it into an
 * investigation. Each shows the server's own result; nothing changes on
 * screen until it confirms.
 */
export function FindingOwnerActions({ findingId, assignedTo, members }: { findingId: string; assignedTo: string | null; members: { userId: string; label: string }[] }) {
  const router = useRouter();
  const [assignee, setAssignee] = useState(assignedTo ?? "");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const post = (path: string, body: unknown, done: (data: Record<string, unknown>) => string) =>
    start(async () => {
      const res = await fetch(`/api/v1/findings/${findingId}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setMessage(null);
        setError(json.error?.message ?? "It could not be saved");
        return;
      }
      setError(null);
      setMessage(done(json.data ?? {}));
      router.refresh();
    });

  return (
    <div className="space-y-3">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          post("owner", { assigneeId: assignee || null }, () => (assignee ? "Assigned." : "Unassigned."));
        }}
      >
        <label className="min-w-[14rem] flex-1">
          <span className="block text-xs font-medium text-muted-foreground">Owner</span>
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={fieldInputClass}>
            <option value="">Nobody</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" size="sm" variant="outline" disabled={pending || assignee === (assignedTo ?? "")}>
          Assign
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => post("escalate", {}, (d) => `Escalated to investigation ${String(d.reference ?? "")}.`)}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          Escalate
        </Button>
      </form>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : message ? (
        <p role="status" className="text-sm text-success">
          {message}
        </p>
      ) : null}
    </div>
  );
}
