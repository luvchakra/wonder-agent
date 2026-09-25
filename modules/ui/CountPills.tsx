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
  variant = "pills",
  className,
}: {
  pills: CountPill[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  /** "tabs": the light-console underline strip ("All Agents (184) · At risk (12)"). Same radio semantics. */
  variant?: "pills" | "tabs";
  className?: string;
}) {
  if (variant === "tabs") {
    return (
      <div
        role="radiogroup"
        aria-label={ariaLabel}
        // The baseline is an inset shadow, not a border: the strip scrolls, so
        // a child's -1px overlap onto a border would be clipped.
        className={cn("flex gap-5 overflow-x-auto shadow-[inset_0_-1px_0_var(--color-border)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}
      >
        {pills.map((pill) => {
          const selected = pill.value === value;
          return (
            <button
              key={pill.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(pill.value)}
              className={cn(
                "flex shrink-0 items-center gap-1 border-b-2 px-0.5 pb-2.5 pt-1 text-[13px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
                selected ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {pill.label}
              <span className="tabular-nums">({pill.count})</span>
            </button>
          );
        })}
      </div>
    );
  }

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
