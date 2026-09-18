import { cn } from "@/lib/utils";

/**
 * Labelled horizontal bars with the percentage spelled out — the design's
 * "Compliance Coverage" panel. A plain div bar rather than a chart: it is
 * one value per row, and real text stays selectable and translatable.
 *
 * Lives apart from charts.tsx on purpose: that file imports the charting
 * library, and this needs none of it, so a screen that only shows bars
 * should not pay for recharts.
 */
export function CoverageBars({ rows }: { rows: Array<{ label: string; percent: number }> }) {
  return (
    <ul className="space-y-3">
      {rows.map((row) => {
        const percent = Math.max(0, Math.min(100, Math.round(row.percent)));
        return (
          <li key={row.label} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3">
            <span className="truncate text-xs text-muted-foreground sm:text-sm">{row.label}</span>
            <span
              role="meter"
              aria-label={row.label}
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-2 overflow-hidden rounded-full bg-muted"
            >
              <span
                className={cn(
                  "block h-full rounded-full",
                  percent >= 80 ? "bg-success" : percent >= 50 ? "bg-warning" : "bg-destructive",
                )}
                style={{ width: `${percent}%` }}
              />
            </span>
            <span className="w-9 text-right text-xs font-medium tabular-nums text-card-foreground">{percent}%</span>
          </li>
        );
      })}
    </ul>
  );
}
