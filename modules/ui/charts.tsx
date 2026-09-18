"use client";

import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";

/**
 * The dashboard's three data visualizations, built to the supplied design.
 *
 * Every colour is a semantic token (--color-success / --color-warning /
 * --color-destructive / …), never a literal hex, so both themes and the
 * rest of the product stay in step. Per UI-UX-DESIGN-RULES.md §19 no
 * series is identified by colour alone: the donut and the trend chart
 * both carry a text legend, and the coverage bars carry a numeric value.
 */

export type Slice = { label: string; value: number; color: string };

const TOOLTIP_STYLE = {
  background: "var(--color-popover)",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--color-popover-foreground)",
} as const;

/**
 * Donut with the total in the middle and a legend beside it. `centerLabel`
 * is what the number means — a bare number in a ring is not self-
 * explanatory.
 */
export function DonutChart({
  slices,
  centerValue,
  centerLabel,
  size = 176,
  className,
}: {
  slices: Slice[];
  centerValue: string | number;
  centerLabel: string;
  size?: number;
  className?: string;
}) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const data = total === 0 ? [{ label: "No data", value: 1, color: "var(--color-muted)" }] : slices;

  return (
    <div className={cn("flex flex-col items-center gap-5 sm:flex-row sm:items-center", className)}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius="66%"
              outerRadius="100%"
              paddingAngle={total === 0 ? 0 : 2}
              stroke="none"
              isAnimationActive={false}
            >
              {data.map((s) => (
                <Cell key={s.label} fill={s.color} />
              ))}
            </Pie>
            {total > 0 && <Tooltip contentStyle={TOOLTIP_STYLE} />}
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tabular-nums text-card-foreground">{centerValue}</span>
          <span className="text-xs text-muted-foreground">{centerLabel}</span>
        </div>
      </div>

      <ul className="w-full min-w-0 space-y-2">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center gap-2.5 text-sm">
            <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{s.label}</span>
            <span className="shrink-0 font-medium tabular-nums text-card-foreground">
              {total === 0 ? "0%" : `${Math.round((s.value / total) * 100)}%`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type TrendSeries = { key: string; label: string; color: string };

/** Multi-series line chart over a shared x axis of dates. */
export function TrendChart({
  data,
  series,
  height = 220,
}: {
  data: Array<Record<string, string | number>>;
  series: TrendSeries[];
  height?: number;
}) {
  const hasData = data.some((row) => series.some((s) => Number(row[s.key] ?? 0) > 0));

  return (
    <div>
      <div style={{ height }}>
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                stroke="var(--color-muted-foreground)"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                minTickGap={16}
              />
              <YAxis
                stroke="var(--color-muted-foreground)"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                width={36}
              />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              {series.map((s) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">Nothing recorded in this period.</p>
          </div>
        )}
      </div>
      <ul className="mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span aria-hidden="true" className="size-2 rounded-full" style={{ background: s.color }} />
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
