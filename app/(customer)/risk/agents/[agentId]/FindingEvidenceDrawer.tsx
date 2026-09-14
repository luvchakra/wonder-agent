"use client";

import { useEffect, useState } from "react";
import { EvidenceDrawer, useEvidenceDrawerParam } from "@/modules/ui/Drawer";
import { Button } from "@/modules/ui/Button";
import { Badge } from "@/modules/ui/Badge";

type Evidence = { id: string; evidenceType: string; referenceId: string; summary: string; createdAt: string };
type FindingDetail = { id: string; title: string; explanation: string; evidence?: Evidence[] };

/**
 * EXPERIENCE-P0-06 — Evidence Drawer & Investigation Deep Links. The
 * `?evidence=<findingId>` query param (via `useEvidenceDrawerParam`) is
 * what makes an open drawer's URL shareable/restorable: reloading this
 * exact URL reopens the same finding's evidence without losing this list's
 * position. One drawer instance serves every row's "View evidence"
 * trigger below.
 */
export function FindingEvidenceTrigger({ findingId }: { findingId: string }) {
  const { open } = useEvidenceDrawerParam();
  return (
    <Button variant="ghost" onClick={() => open(findingId)}>
      View evidence
    </Button>
  );
}

export function FindingEvidenceDrawer() {
  const { value: findingId, close } = useEvidenceDrawerParam();
  const [detail, setDetail] = useState<FindingDetail | null>(null);

  useEffect(() => {
    if (!findingId) return;
    let cancelled = false;
    fetch(`/api/v1/findings/${findingId}`)
      .then((r) => r.json())
      .then((body) => {
        if (!cancelled && body.ok) setDetail(body.data);
      });
    return () => {
      cancelled = true;
    };
  }, [findingId]);

  // Guards against showing a stale finding's evidence while a new one is
  // loading (e.g. deep-linking straight from one finding's URL to another).
  const showDetail = detail && detail.id === findingId ? detail : null;

  return (
    <EvidenceDrawer open={findingId !== null} onOpenChange={(open) => !open && close()} title={showDetail?.title ?? "Finding evidence"}>
      {findingId && !showDetail && <p className="text-sm text-text-secondary">Loading…</p>}
      {showDetail && (
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">{showDetail.explanation}</p>
          <ul className="space-y-2">
            {(showDetail.evidence ?? []).map((e) => (
              <li key={e.id} className="rounded-md border border-border bg-surface-elevated p-2 text-sm">
                <Badge tone="neutral">{e.evidenceType}</Badge>
                <p className="mt-1 text-text-primary">{e.summary}</p>
                <p className="mt-1 text-xs text-text-muted">{e.createdAt}</p>
              </li>
            ))}
            {(showDetail.evidence ?? []).length === 0 && <p className="text-sm text-text-muted">No evidence recorded.</p>}
          </ul>
        </div>
      )}
    </EvidenceDrawer>
  );
}
