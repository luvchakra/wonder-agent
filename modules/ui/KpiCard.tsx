import Link from "next/link";
import { cn } from "@/lib/utils";
import { NavIcon } from "./NavIcon";

export type KpiTone = "neutral" | "primary" | "success" | "warning" | "danger" | "violet";

const TILE: Record<KpiTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  primary: "bg-primary/10 text-primary",
  success: "bg-success/12 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-destructive/10 text-destructive",
  violet: "bg-violet/12 text-violet",
};

/** The tinted card surface used when a metric is flagged for attention. */
const EMPHASIS: Record<KpiTone, string> = {
  neutral: "",
  primary: "border-primary/20 bg-primary/[0.04]",
  success: "border-success/25 bg-success/[0.05]",
  warning: "border-warning/30 bg-warning/[0.07]",
  danger: "border-destructive/25 bg-destructive/[0.05]",
  violet: "border-violet/25 bg-violet/[0.05]",
};

/**
 * A headline metric card, laid out as in the 2026-09-25 light-console
 * mockups: a tinted icon tile on the left; beside it the label, the number
 * with its change, and one line of context. `emphasis` tints the whole card
 * for metrics that need attention (high risk, unregistered, blocked).
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
  emphasis = false,
  size = "md",
  delta,
  footnote,
  href,
}: {
  icon: string;
  label: string;
  value: string | number;
  tone?: KpiTone;
  emphasis?: boolean;
  /** "sm": the inventory screens' compact strip — smaller tile and number. */
  size?: "sm" | "md";
  delta?: { direction: "up" | "down"; text: string; good?: boolean } | null;
  footnote?: string | null;
  href?: string;
}) {
  const body = (
    <div className="flex items-start gap-3">
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-xl",
          size === "sm" ? "size-9" : "size-11",
          TILE[tone],
        )}
      >
        <NavIcon name={icon} className={size === "sm" ? "size-[18px]" : "size-[22px]"} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span
            className={cn(
              "font-semibold leading-none tracking-[-0.02em] tabular-nums text-card-foreground",
              size === "sm" ? "text-xl" : "text-[26px]",
            )}
          >
            {value}
          </span>
          {delta ? (
            <span
              className={cn(
                "text-xs font-medium tabular-nums",
                delta.good === false ? "text-destructive" : delta.good ? "text-success" : "text-muted-foreground",
              )}
            >
              {delta.direction === "up" ? "↑" : "↓"} {delta.text}
            </span>
          ) : null}
        </div>
        {footnote ? <p className="mt-1.5 truncate text-xs text-muted-foreground">{footnote}</p> : null}
      </div>
    </div>
  );

  const className = cn(
    "block min-w-0 rounded-xl border border-border/70 bg-card text-card-foreground shadow-sm transition-colors",
    size === "sm" ? "p-3" : "p-4",
    emphasis && EMPHASIS[tone],
  );

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
