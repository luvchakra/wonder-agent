"use client";

import { useEffect, useState } from "react";
import { EvidenceDrawer, useEvidenceDrawerParam, Button, Badge } from "@/modules/ui";

type AccessPathStep = { step: string; ref: string; type?: string; entitlement?: string; application?: string; dataClassification?: string | null };
type AccessPath = { agentId: string; resource: string; path: AccessPathStep[] };

/**
 * EXPERIENCE-P0-06 — Access Agent's explainAccessPath() ("why can this
 * agent access Y") surfaced via the same EvidenceDrawer/deep-link pattern
 * Risk's finding evidence established, namespaced under `?path=` so it
 * doesn't collide with another drawer on the same page.
 */
export function AccessPathEvidenceTrigger({ resourceRef }: { resourceRef: string }) {
  const { open } = useEvidenceDrawerParam("path");
  return (
    <Button variant="ghost" size="sm" onClick={() => open(resourceRef)}>
      Explain access
    </Button>
  );
}

export function AccessPathEvidenceDrawer({ agentId }: { agentId: string }) {
  const { value: resourceRef, close } = useEvidenceDrawerParam("path");
  const [path, setPath] = useState<AccessPath | null>(null);
  const [attemptedRef, setAttemptedRef] = useState<string | null>(null);

  useEffect(() => {
    if (!resourceRef) return;
    let cancelled = false;
    fetch(`/api/v1/access/agents/${agentId}/explain?resource=${encodeURIComponent(resourceRef)}`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        setPath(body.ok ? body.data : null);
        setAttemptedRef(resourceRef);
      });
    return () => {
      cancelled = true;
    };
  }, [agentId, resourceRef]);

  const showPath = path && path.resource === resourceRef ? path : null;
  const loading = resourceRef !== null && attemptedRef !== resourceRef;

  return (
    <EvidenceDrawer open={resourceRef !== null} onOpenChange={(open) => !open && close()} title={resourceRef ? `Access path — ${resourceRef}` : "Access path"}>
      {resourceRef && loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {resourceRef && !loading && !showPath && <p className="text-sm text-muted-foreground">No access path found for this resource.</p>}
      {showPath && (
        <ol className="space-y-2">
          {showPath.path.map((step, i) => (
            <li key={i} className="rounded-md border border-border bg-muted p-2 text-sm">
              <Badge tone="neutral">{step.step.replace(/_/g, " ")}</Badge>
              <p className="mt-1 text-foreground">{step.ref}</p>
              {step.type && <p className="text-xs text-muted-foreground">type: {step.type}</p>}
              {step.dataClassification && <p className="text-xs text-muted-foreground">classification: {step.dataClassification}</p>}
            </li>
          ))}
        </ol>
      )}
    </EvidenceDrawer>
  );
}
