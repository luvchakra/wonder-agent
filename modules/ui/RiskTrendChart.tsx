"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const SEVERITY_COLORS: Record<string, string> = {
  critical: "var(--color-destructive)",
  high: "var(--color-warning)",
  medium: "var(--color-info)",
  low: "var(--color-muted-foreground)",
};

/** EXPERIENCE-P0-02.2. Answers a real question (how much open risk, by severity) — not decoration. */
export function RiskTrendChart({ bySeverity }: { bySeverity: Record<string, number> }) {
  const data = (["critical", "high", "medium", "low"] as const).map((severity) => ({
    severity,
    count: bySeverity[severity] ?? 0,
  }));

  const total = data.reduce((sum, d) => sum + d.count, 0);
  if (total === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No open findings.</p>;
  }

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
          <XAxis type="number" allowDecimals={false} stroke="var(--color-muted-foreground)" fontSize={12} />
          <YAxis type="category" dataKey="severity" width={70} stroke="var(--color-muted-foreground)" fontSize={12} />
          <Tooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8 }} />
          <Bar dataKey="count" radius={[0, 4, 4, 0]}>
            {data.map((d) => (
              <Cell key={d.severity} fill={SEVERITY_COLORS[d.severity]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
