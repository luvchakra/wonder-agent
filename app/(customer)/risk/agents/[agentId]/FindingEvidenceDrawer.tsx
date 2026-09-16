"use client";

import { useEffect, useState } from "react";
import { EvidenceDrawer, useEvidenceDrawerParam } from "@/modules/ui/Drawer";
import { Button } from "@/modules/ui/Button";
import { Badge } from "@/modules/ui/Badge";

type Evidence = { id: string; evidenceType: string; referenceId: string; summary: string; createdAt: string };
type FindingDetail = { id: string; title: string; explanation: string; evidence?: Evidence[] };
type CanEntry = { application: string; entitlementName: string; dataClassification: string | null };
type HistoricalContext = { finding: { createdAt: string }; comparisonAsOfDetection: { can: CanEntry[] }; forFindingId: string };

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
  const [historicalContext, setHistoricalContext] = useState<HistoricalContext | null>(null);
  const [historicalContextLoading, setHistoricalContextLoading] = useState(false);

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
  // Same guard for the historical-context panel — never shows the
  // previous finding's data while the drawer is switching findings.
  const showHistoricalContext = historicalContext && historicalContext.forFindingId === findingId ? historicalContext : null;

  async function loadHistoricalContext() {
    if (!findingId) return;
    setHistoricalContextLoading(true);
    try {
      const response = await fetch(`/api/v1/findings/${findingId}/historical-context`);
      const body = await response.json();
      if (body.ok) setHistoricalContext({ ...body.data, forFindingId: findingId });
    } finally {
      setHistoricalContextLoading(false);
    }
  }

  return (
    <EvidenceDrawer open={findingId !== null} onOpenChange={(open) => !open && close()} title={showDetail?.title ?? "Finding evidence"}>
      {findingId && !showDetail && <p className="text-sm text-muted-foreground">Loading…</p>}
      {showDetail && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{showDetail.explanation}</p>
          <ul className="space-y-2">
            {(showDetail.evidence ?? []).map((e) => (
              <li key={e.id} className="rounded-md border border-border bg-muted p-2 text-sm">
                <Badge tone="neutral">{e.evidenceType}</Badge>
                <p className="mt-1 text-foreground">{e.summary}</p>
                <p className="mt-1 text-xs text-muted-foreground">{e.createdAt}</p>
              </li>
            ))}
            {(showDetail.evidence ?? []).length === 0 && <p className="text-sm text-muted-foreground">No evidence recorded.</p>}
          </ul>

          <div className="border-t border-border pt-3">
            {!showHistoricalContext && (
              <Button variant="ghost" onClick={loadHistoricalContext} disabled={historicalContextLoading}>
                {historicalContextLoading ? "Loading…" : "Show access as of detection time"}
              </Button>
            )}
            {showHistoricalContext && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Effective access as of {new Date(showHistoricalContext.finding.createdAt).toLocaleString()} (when this finding was
                  first detected) — may differ from the agent&apos;s current access if entitlements have since changed.
                </p>
                <ul className="space-y-1">
                  {showHistoricalContext.comparisonAsOfDetection.can.map((c, i) => (
                    <li key={i} className="rounded-md border border-border bg-muted p-2 text-xs text-foreground">
                      {c.application}: {c.entitlementName} {c.dataClassification ? `(${c.dataClassification})` : ""}
                    </li>
                  ))}
                  {showHistoricalContext.comparisonAsOfDetection.can.length === 0 && (
                    <li className="text-xs text-muted-foreground">No effective access at that time.</li>
                  )}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </EvidenceDrawer>
  );
}
