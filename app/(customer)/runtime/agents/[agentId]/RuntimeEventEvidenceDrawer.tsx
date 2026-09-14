"use client";

import { EvidenceDrawer, useEvidenceDrawerParam, Button, Badge } from "@/modules/ui";

type RuntimeEventRow = {
  id: string;
  eventTime: string;
  source: string;
  tool: string | null;
  application: string | null;
  resource: string | null;
  action: string;
  dataClassification: string | null;
  success: boolean;
  correlationId: string | null;
  raw: Record<string, unknown>;
};

/**
 * EXPERIENCE-P0-06 — the events list is already fully loaded server-side
 * (no server pagination beyond the page's own limit), so this drawer opens
 * against the already-fetched rows rather than a second fetch — same
 * deep-linkable `?event=<id>` pattern as Risk's finding evidence, just
 * without the loading-state branch since there's nothing left to load.
 */
export function RuntimeEventEvidenceTrigger({ eventId }: { eventId: string }) {
  const { open } = useEvidenceDrawerParam("event");
  return (
    <Button variant="ghost" size="sm" onClick={() => open(eventId)}>
      Details
    </Button>
  );
}

export function RuntimeEventEvidenceDrawer({ events }: { events: RuntimeEventRow[] }) {
  const { value: eventId, close } = useEvidenceDrawerParam("event");
  const event = events.find((e) => e.id === eventId) ?? null;

  return (
    <EvidenceDrawer open={eventId !== null} onOpenChange={(open) => !open && close()} title={event ? `Event — ${event.application ?? "?"}/${event.resource ?? "?"}` : "Event details"}>
      {eventId && !event && <p className="text-sm text-muted-foreground">Event not found on this page — try the first page of results.</p>}
      {event && (
        <div className="space-y-3">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Source</dt>
              <dd>
                <Badge tone="neutral">{event.source}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Outcome</dt>
              <dd>
                <Badge tone={event.success ? "success" : "danger"}>{event.success ? "success" : "failure"}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Tool</dt>
              <dd className="text-foreground">{event.tool ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Action</dt>
              <dd className="text-foreground">{event.action}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Data classification</dt>
              <dd className="text-foreground">{event.dataClassification ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Correlation ID</dt>
              <dd className="text-foreground">{event.correlationId ?? "—"}</dd>
            </div>
          </dl>
          <div>
            <p className="text-xs text-muted-foreground">Raw event payload</p>
            <pre className="mt-1 overflow-x-auto rounded-md border border-border bg-muted p-2 text-xs text-foreground">{JSON.stringify(event.raw, null, 2)}</pre>
          </div>
        </div>
      )}
    </EvidenceDrawer>
  );
}
