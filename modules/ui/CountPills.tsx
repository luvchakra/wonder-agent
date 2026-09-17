"use client";

import { cn } from "@/lib/utils";

export type CountPill = { value: string; label: string; count: number; tone?: "neutral" | "success" | "warning" | "danger" };

const ACTIVE_TONE: Record<NonNullable<CountPill["tone"]>, string> = {
  neutral: "bg-primary text-primary-foreground",
  success: "bg-success text-primary-foreground",
  warning: "bg-warning text-primary-foreground",
  danger: "bg-destructive text-destructive-foreground",
};

const IDLE_COUNT_TONE: Record<NonNullable<CountPill["tone"]>, string> = {
  neutral: "text-muted-foreground",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
};

/**
 * The design's count pills ("All 248 · Approved 182 · At Risk 11") above a
 * list. Rendered as a radio group rather than buttons so the selected
 * filter is announced as one choice out of a set, and so arrow keys move
 * between the options.
 *
 * The strip scrolls horizontally instead of wrapping, so it stays one row
 * deep on a phone.
 */
export function CountPills({
  pills,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  pills: CountPill[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn("-mx-1 flex gap-1.5 overflow-x-auto px-1 py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}
    >
      {pills.map((pill) => {
        const tone = pill.tone ?? "neutral";
        const selected = pill.value === value;
        return (
          <button
            key={pill.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(pill.value)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
              selected
                ? ACTIVE_TONE[tone]
                : "border border-border bg-card text-muted-foreground hover:border-ring/50 hover:text-foreground",
            )}
          >
            {pill.label}
            <span className={cn("tabular-nums", selected ? "opacity-80" : IDLE_COUNT_TONE[tone])}>{pill.count}</span>
          </button>
        );
      })}
    </div>
  );
}
