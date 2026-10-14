"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/modules/ui";

export function AnswerForm({ consultationId }: { consultationId: string }) {
  const router = useRouter();
  const [answer, setAnswer] = useState("");
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState({ busy: true });
    const res = await fetch(`/api/v1/compliance/consultations/${consultationId}/answer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answer }) });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) return setState({ busy: false, error: body?.error?.message ?? "Could not send the answer" });
    router.refresh();
  }
  return (
    <form onSubmit={submit} className="mt-4 space-y-3">
      <label htmlFor="answer" className="text-sm font-medium text-foreground">
        Your answer
      </label>
      <textarea id="answer" required maxLength={2000} value={answer} onChange={(e) => setAnswer(e.target.value)} className="min-h-28 w-full rounded-md border border-input bg-background p-2 text-sm text-foreground" />
      {state.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
      <Button type="submit" disabled={state.busy || !answer.trim()}>
        {state.busy ? "Sending…" : "Send answer"}
      </Button>
    </form>
  );
}
