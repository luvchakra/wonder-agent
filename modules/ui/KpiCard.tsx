import Link from "next/link";
import { cn } from "@/lib/utils";
import { NavIcon } from "./NavIcon";

export type KpiTone = "neutral" | "primary" | "success" | "warning" | "danger";

const TILE: Record<KpiTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  primary: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-destructive/10 text-destructive",
};

/**
 * The dashboard's headline metric card: a tinted icon tile, the number,
 * what it counts, and an optional secondary figure (a share of the total,
 * or a period-over-period change).
 *
 * `delta` is rendered as text with an explicit sign, not as a bare
 * coloured arrow — colour is never the only carrier of meaning
 * (UI-UX-DESIGN-RULES.md §19).
 */
export function KpiCard({
  icon,
  label,
  value,
  tone = "neutral",
  delta,
  footnote,
  href,
}: {
  icon: string;
  label: string;
  value: string | number;
  tone?: KpiTone;
  delta?: { direction: "up" | "down"; text: string; good?: boolean } | null;
  footnote?: string | null;
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", TILE[tone])}>
          <NavIcon name={icon} className="size-5" />
        </span>
        {delta ? (
          <span
            className={cn(
              "shrink-0 text-xs font-medium tabular-nums",
              delta.good === false ? "text-destructive" : delta.good ? "text-success" : "text-muted-foreground",
            )}
          >
            {delta.direction === "up" ? "▲" : "▼"} {delta.text}
          </span>
        ) : null}
      </div>
      <p className="mt-3 text-[28px] font-semibold leading-none tabular-nums text-card-foreground">{value}</p>
      <p className="mt-1.5 text-sm text-muted-foreground">{label}</p>
      {footnote ? <p className="mt-0.5 text-xs text-muted-foreground/80">{footnote}</p> : null}
    </>
  );

  const className =
    "block rounded-xl border border-border/60 bg-card p-4 text-card-foreground shadow-md transition-colors";

  if (href) {
    return (
      <Link
        href={href}
        className={cn(className, "hover:border-ring/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring")}
      >
        {body}
      </Link>
    );
  }
  return <div className={className}>{body}</div>;
}
