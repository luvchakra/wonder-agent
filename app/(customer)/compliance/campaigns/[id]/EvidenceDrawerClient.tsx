"use client";

import { useEffect, useState } from "react";
import { EvidenceDrawer, useEvidenceDrawerParam, Button, Badge } from "@/modules/ui";
import type { CertificationSnapshot } from "@/lib/shared/types/compliance";

type ItemForEvidence = { id: string; agentId: string | null; snapshot: CertificationSnapshot | null };

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

type ConsultationRow = { id: string; question: string; answer: string | null; answeredAt: string | null; createdAt: string };

/** COMPLIANCE-P0-14 part 3: the questions the reviewer asked about this item, and their answers. */
function Consultations({ itemId }: { itemId: string }) {
  const [rows, setRows] = useState<ConsultationRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    fetch(`/api/v1/compliance/items/${itemId}/consultations`)
      .then((r) => r.json())
      .then((b) => live && (b.ok ? setRows(b.data) : setFailed(true)))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [itemId]);
  if (failed) return <p className="text-sm text-muted-foreground">Questions unavailable.</p>;
  if (rows === null) return <p className="text-sm text-muted-foreground">Loading questions…</p>;
  if (rows.length === 0) return null;
  return (
    <div className="text-sm">
      <p className="text-xs text-muted-foreground">Questions asked</p>
      <ul className="mt-1 space-y-1">
        {rows.map((c) => (
          <li key={c.id} className="rounded-md border border-border bg-muted p-2">
            <p className="text-foreground">{c.question}</p>
            <p className="text-muted-foreground">{c.answer ? `Answer: ${c.answer}` : "Not answered yet"}</p>
          </li>
        ))}
      </ul>
    </div>
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
          {snapshot.catalogEntitlement ? (
            <div>
              <p className="text-xs text-muted-foreground">Application entitlement</p>
              <p className="text-foreground">
                {snapshot.catalogEntitlement.application.name}: {snapshot.catalogEntitlement.name}
                {snapshot.catalogEntitlement.privilegeLevel ? ` · ${snapshot.catalogEntitlement.privilegeLevel}` : ""}
              </p>
            </div>
          ) : snapshot.package ? (
            <div>
              <p className="text-xs text-muted-foreground">Access package</p>
              <p className="text-foreground">
                {snapshot.package.name}
                {snapshot.package.birthright ? " (birthright)" : ""} · {snapshot.package.resource.applicationName}
                {snapshot.package.resource.entitlementName ? `: ${snapshot.package.resource.entitlementName}` : " (the application)"}
                {snapshot.package.resource.privilegeLevel ? ` · ${snapshot.package.resource.privilegeLevel}` : ""}
              </p>
            </div>
          ) : snapshot.person ? (
            <div>
              <p className="text-xs text-muted-foreground">Whose access</p>
              <p className="text-foreground">
                {snapshot.person.displayName} ({snapshot.person.identityType.toLowerCase().replace(/_/g, " ")}){snapshot.account ? ` · account ${snapshot.account.ref}` : ""}
              </p>
            </div>
          ) : (
            <div>
              <p className="text-xs text-muted-foreground">Agent contract</p>
              <p className="text-foreground">
                {snapshot.agentContractId ? `v${snapshot.agentContractVersion} (${snapshot.agentContractId})` : "No active contract at capture time"}
              </p>
            </div>
          )}
          <div>
            <p className="text-xs text-muted-foreground">{snapshot.role ? "WonderID role" : "Access grant"}</p>
            {snapshot.role ? (
              <p className="text-foreground">
                {snapshot.role.displayName}
                {snapshot.role.privileged ? " (privileged)" : ""} · {snapshot.role.group ? `through group ${snapshot.role.group.name}` : "assigned directly"}
                {snapshot.role.expiresAt ? ` · until ${snapshot.role.expiresAt}` : ""}
              </p>
            ) : snapshot.accessGrant ? (
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
      {item && <Consultations itemId={item.id} />}
    </EvidenceDrawer>
  );
}
