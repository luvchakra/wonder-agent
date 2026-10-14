"use client";

import { useState } from "react";
import { Button } from "@/modules/ui";

type Preview = { items: number; subjects: number; privileged: number; reviewers: number; reviewerFallbacks: number };

/**
 * COMPLIANCE-P0-14: counts what the surrounding launch form would create,
 * read only (POST /api/v1/compliance/campaigns/preview). Nothing is written.
 */
export function CampaignPreviewButton() {
  const [state, setState] = useState<{ busy: boolean; preview?: Preview; error?: string }>({ busy: false });

  async function preview(e: React.MouseEvent<HTMLButtonElement>) {
    const form = e.currentTarget.form;
    if (!form) return;
    const f = new FormData(form);
    const criticality = String(f.get("criticality") ?? "");
    setState({ busy: true });
    const res = await fetch("/api/v1/compliance/campaigns/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scopeType: f.get("scopeType"),
        scope: { ...(criticality ? { criticality: criticality.split(",").map((s) => s.trim()) } : {}), ...(f.get("privilegedOnly") === "on" ? { privilegedOnly: true } : {}) },
        reviewerKind: f.get("reviewerKind") || undefined,
        reviewerId: String(f.get("reviewerId") ?? "").trim() || undefined,
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) setState({ busy: false, error: body?.error?.message ?? "Preview unavailable" });
    else setState({ busy: false, preview: body.data as Preview });
  }

  const p = state.preview;
  return (
    <>
      <Button type="button" variant="secondary" onClick={preview} disabled={state.busy}>
        {state.busy ? "Counting…" : "Preview"}
      </Button>
      <span role="status" className="text-sm text-muted-foreground">
        {state.error
          ? state.error
          : p
            ? `${p.items} item${p.items === 1 ? "" : "s"} for ${p.subjects} ${p.subjects === 1 ? "identity" : "identities"}, ${p.privileged} high-risk or privileged, ${p.reviewers} reviewer${p.reviewers === 1 ? "" : "s"}${p.reviewerFallbacks ? ` (${p.reviewerFallbacks} to the named reviewer)` : ""}`
            : null}
      </span>
    </>
  );
}
