import { cn } from "@/lib/utils";

/**
 * One muted line under an object's title: who created it and when, who
 * last changed it and when (owner decision, 2026-10-10). Shown on every
 * object's page. A missing name (a record made before provenance was
 * kept, or by a job) shows the date alone; nothing is invented.
 */
export type RecordProvenanceData = {
  createdAt: string | null;
  createdBy: { id: string; name: string } | null;
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
};

export type RecordProvenanceProps = { record: RecordProvenanceData | null; className?: string };

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";

/** The line's wording, shared with its test. */
export function provenanceText(p: RecordProvenanceData): { created: string | null; updated: string | null } {
  const created = p.createdAt ? `Created${p.createdBy ? ` by ${p.createdBy.name}` : ""} on ${when(p.createdAt)}` : null;
  const changed = p.updatedAt && p.createdAt && Math.abs(new Date(p.updatedAt).getTime() - new Date(p.createdAt).getTime()) > 1000;
  const updated = p.updatedAt && (changed || !p.createdAt) ? `Updated${p.updatedBy ? ` by ${p.updatedBy.name}` : ""} on ${when(p.updatedAt)}` : null;
  return { created, updated };
}

export function RecordProvenance({ record, className }: RecordProvenanceProps) {
  if (!record) return null;
  const { created, updated } = provenanceText(record);
  if (!created && !updated) return null;
  return (
    <p className={cn("text-xs text-muted-foreground", className)} data-testid="record-provenance">
      {created}
      {created && updated ? " · " : ""}
      {updated}
    </p>
  );
}
