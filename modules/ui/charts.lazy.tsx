"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { DonutChart as DonutChartImpl, TrendChart as TrendChartImpl } from "./charts";

/**
 * The chart components, loaded on demand.
 *
 * recharts is the single heaviest dependency in the client bundle. Every
 * screen mounted under the customer shell was paying to download and parse
 * it whether or not it drew a chart, and the charts render nothing useful
 * on the server anyway (ResponsiveContainer needs a measured box). So the
 * dashboard and the agent detail import these wrappers instead: the
 * library arrives in its own chunk, only on screens that draw, and the
 * server sends the same skeleton the chart's own empty state uses.
 */

function ChartSkeleton({ height }: { height: number }) {
  return <div aria-hidden="true" className="animate-pulse rounded-lg bg-muted" style={{ height }} />;
}

export const DonutChart = dynamic<ComponentProps<typeof DonutChartImpl>>(
  () => import("./charts").then((m) => m.DonutChart),
  { ssr: false, loading: () => <ChartSkeleton height={160} /> },
);

export const TrendChart = dynamic<ComponentProps<typeof TrendChartImpl>>(
  () => import("./charts").then((m) => m.TrendChart),
  { ssr: false, loading: () => <ChartSkeleton height={252} /> },
);
