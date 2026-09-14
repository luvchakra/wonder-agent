"use client";

import { EvidenceDrawer, useEvidenceDrawerParam, Button, Badge } from "@/modules/ui";
import type { CertificationSnapshot } from "@/lib/shared/types/compliance";

type ItemForEvidence = { id: string; agentId: string; snapshot: CertificationSnapshot | null };

/**
 * EXPERIENCE-P0-06 — the point-in-time evidence snapshot (COMPLIANCE-P0-03)
 * a reviewer saw, surfaced via the same deep-linkable drawer pattern —
 * already loaded server-side with the campaign items, no extra fetch.
 */
export function EvidenceTrigger({ itemId }: { itemId: string }) {
  const { open } = useEvidenceDrawerParam("snapshot");
  return (
    <Button variant="ghost" size="sm" onClick={() => open(itemId)}>
      View evidence
    </Button>
  );
}

export function EvidenceDrawerClient({ items }: { items: ItemForEvidence[] }) {
  const { value: itemId, close } = useEvidenceDrawerParam("snapshot");
  const item = items.find((i) => i.id === itemId) ?? null;
  const snapshot = item?.snapshot ?? null;

  return (
    <EvidenceDrawer open={itemId !== null} onOpenChange={(open) => !open && close()} title="Certification evidence snapshot">
      {itemId && !item && <p className="text-sm text-muted-foreground">Item not found on this page.</p>}
      {item && !snapshot && <p className="text-sm text-muted-foreground">No snapshot recorded — this item predates COMPLIANCE-P0-03.</p>}
      {snapshot && (
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">Captured {snapshot.capturedAt}</p>
          <div>
            <p className="text-xs text-muted-foreground">Agent contract</p>
            <p className="text-foreground">
              {snapshot.agentContractId ? `v${snapshot.agentContractVersion} (${snapshot.agentContractId})` : "No active contract at capture time"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Access grant</p>
            {snapshot.accessGrant ? (
              <p className="text-foreground">
                {snapshot.accessGrant.application ?? "?"}:{snapshot.accessGrant.entitlementName ?? "?"}
                {snapshot.accessGrant.dataClassification ? ` (${snapshot.accessGrant.dataClassification})` : ""}
              </p>
            ) : (
              <p className="text-foreground">—</p>
            )}
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Risk / Usage at review</p>
            <p className="text-foreground">
              {snapshot.riskAtReview ?? "—"} / {snapshot.usageAtReview ?? "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Policy evaluations at capture time</p>
            {snapshot.policyEvaluations.length === 0 ? (
              <p className="text-foreground">None</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {snapshot.policyEvaluations.map((pe, i) => (
                  <li key={i} className="rounded-md border border-border bg-muted p-2">
                    <Badge tone={pe.result === "pass" ? "success" : pe.result === "violation" ? "danger" : "warning"}>{pe.result}</Badge>{" "}
                    <span className="text-foreground">policy {pe.policyId} v{pe.policyVersion}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </EvidenceDrawer>
  );
}
