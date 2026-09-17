import { Activity, FileCheck2, KeyRound, ScanLine, ShieldAlert } from "lucide-react";

/**
 * The evaluation pipeline, animated: three sources flow into the
 * comparison, and the comparison emits a finding.
 *
 * Built from real HTML nodes with small SVG connectors between them rather
 * than one wide SVG, so the labels stay real text (selectable, translatable,
 * readable by AT) and the whole thing reflows from a row to a column at
 * small widths instead of scaling into illegibility. Motion is a travelling
 * stroke dash defined in app/globals.css, disabled under
 * prefers-reduced-motion — it conveys direction, never information.
 */

const SOURCES = [
  { icon: FileCheck2, label: "Agent contract", meta: "SHOULD" },
  { icon: KeyRound, label: "IAM entitlements", meta: "CAN" },
  { icon: Activity, label: "Runtime events", meta: "DID" },
] as const;

function Connector({ orientation }: { orientation: "horizontal" | "vertical" }) {
  const horizontal = orientation === "horizontal";
  return (
    <svg
      aria-hidden="true"
      viewBox={horizontal ? "0 0 100 8" : "0 0 8 100"}
      preserveAspectRatio="none"
      className={horizontal ? "hidden h-2 w-full flex-1 md:block" : "h-10 w-2 md:hidden"}
    >
      <line
        x1={horizontal ? 0 : 4}
        y1={horizontal ? 4 : 0}
        x2={horizontal ? 100 : 4}
        y2={horizontal ? 4 : 100}
        stroke="var(--border)"
        strokeWidth={horizontal ? 1.5 : 1.5}
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={horizontal ? 0 : 4}
        y1={horizontal ? 4 : 0}
        x2={horizontal ? 100 : 4}
        y2={horizontal ? 4 : 100}
        stroke="var(--primary)"
        strokeWidth={horizontal ? 1.5 : 1.5}
        vectorEffect="non-scaling-stroke"
        className="wa-flow-line"
      />
    </svg>
  );
}

export function FlowDiagram() {
  return (
    <div className="flex flex-col items-stretch gap-0 md:flex-row md:items-center md:gap-3">
      {/* sources */}
      <div className="grid shrink-0 gap-2 md:w-56">
        {SOURCES.map(({ icon: Icon, label, meta }) => (
          <div
            key={label}
            className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 shadow-[var(--shadow-sm)]"
          >
            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">{label}</span>
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {meta}
            </span>
          </div>
        ))}
      </div>

      <div className="flex justify-center md:flex-1">
        <Connector orientation="vertical" />
        <Connector orientation="horizontal" />
      </div>

      {/* the comparison */}
      <div className="relative shrink-0 rounded-xl border border-primary/30 bg-card px-4 py-4 text-center shadow-[var(--shadow-md)] md:w-52">
        <span
          aria-hidden="true"
          className="wa-pulse-ring absolute inset-0 -z-10 rounded-xl border border-primary/40"
        />
        <ScanLine className="mx-auto size-5 text-primary" aria-hidden="true" />
        <p className="mt-2 text-sm font-semibold text-foreground">Continuous comparison</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Deterministic. Re-run on every access or behaviour change.
        </p>
      </div>

      <div className="flex justify-center md:flex-1">
        <Connector orientation="vertical" />
        <Connector orientation="horizontal" />
      </div>

      {/* the output */}
      <div className="shrink-0 rounded-xl border border-destructive/30 bg-card px-4 py-4 shadow-[var(--shadow-sm)] md:w-56">
        <div className="flex items-center gap-2">
          <ShieldAlert className="size-4 text-destructive" aria-hidden="true" />
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-destructive">
            Critical finding
          </span>
        </div>
        <p className="mt-2 text-sm text-foreground">Excessive access, with evidence</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Recorded with evidence, applied only on human approval.
        </p>
      </div>
    </div>
  );
}
