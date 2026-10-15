import { readFieldChanges, type AuditFieldChange } from "@/lib/audit/changes";

/**
 * FOUNDATION-P0-33: the fields an audited edit changed, old → new, folded
 * under the action (§19.5). Nothing when the event recorded no changes.
 */
export function AuditChanges({ metadata }: { metadata: Record<string, unknown> | null | undefined }) {
  const changes = readFieldChanges(metadata);
  if (!changes.length) return null;
  return (
    <details className="mt-1 font-sans">
      <summary className="cursor-pointer text-xs text-primary">
        {changes.length} {changes.length === 1 ? "change" : "changes"}
      </summary>
      <dl className="mt-1 space-y-1 text-xs">
        {changes.map((c) => (
          <div key={c.field} className="break-words">
            <dt className="inline font-medium text-foreground">{c.field}: </dt>
            <dd className="inline text-muted-foreground">{describe(c)}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

const OMITTED: Record<NonNullable<AuditFieldChange["omitted"]>, string> = {
  text: "changed (text is kept on the record, not in the audit)",
  secret: "changed (secret, never shown)",
  too_long: "changed (too long to show)",
};

function describe(c: AuditFieldChange): string {
  if (c.omitted) return OMITTED[c.omitted];
  return `${show(c.from)} → ${show(c.to)}`;
}

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "(empty)";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}
