"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "./Button";
import type { AiSummaryKind } from "@/lib/shared/types/ai";

type PanelState = "idle" | "loading" | "unavailable" | "error" | "done";

/**
 * EXPERIENCE-P0-14 — AI-Assisted Investigation UI (read-only summaries
 * only, per the 2026-09-15 resolved decision). Calls
 * `POST /api/v1/ai/summarize`, which wraps Foundation's `lib/ai/summarize`
 * primitive (FOUNDATION-P0-16). Renders the returned text clearly labeled
 * as AI-generated/advisory, always alongside — never instead of — the
 * authoritative structured data passed in via `data`; this component never
 * fetches or computes that data itself (non-negotiable #9 — nothing here
 * can become a decision input). Until a provider is configured, every call
 * deterministically 501s and this renders a plain "not yet configured"
 * notice rather than a crash or a fake summary.
 */
export function AiSummaryPanel({ kind, data, label = "Summarize with AI" }: { kind: AiSummaryKind; data: Record<string, unknown>; label?: string }) {
  const [state, setState] = useState<PanelState>("idle");
  const [summary, setSummary] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSummarize() {
    setState("loading");
    setErrorMessage(null);
    try {
      const res = await fetch("/api/v1/ai/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, data }),
      });
      if (res.status === 501) {
        setState("unavailable");
        return;
      }
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setErrorMessage(json?.error?.message ?? "Couldn't generate a summary.");
        setState("error");
        return;
      }
      setSummary(json.data.summary as string);
      setState("done");
    } catch {
      setErrorMessage("Couldn't reach the summarization service.");
      setState("error");
    }
  }

  if (state === "idle") {
    return (
      <Button variant="outline" size="sm" onClick={handleSummarize}>
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </Button>
    );
  }

  if (state === "loading") {
    return (
      <div className="text-sm text-muted-foreground" role="status" aria-live="polite">
        Generating summary…
      </div>
    );
  }

  if (state === "unavailable") {
    return (
      <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground" role="note">
        AI summaries aren&apos;t configured for this workspace yet.
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="flex items-center gap-2 text-sm text-destructive" role="alert">
        <span>{errorMessage}</span>
        <button type="button" onClick={handleSummarize} className="underline underline-offset-2">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-info/30 bg-info/5 p-3 text-sm" role="note" aria-label="AI-generated advisory summary">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-info">
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        AI-generated summary — advisory only, not a decision
      </div>
      <p className="text-foreground">{summary}</p>
    </div>
  );
}
