import { cn } from "@/lib/utils";

/**
 * EXPERIENCE-P0-09.1 — rounded-xl + shadow-md (was rounded-lg + shadow-sm)
 * to read as a softer, shadow-elevated white card on the reskinned light
 * background, per the reference screenshots' visual language; the border
 * stays (now border/60) as a defense-in-depth boundary for users/contexts
 * where shadow alone isn't a reliable enough cue (prefers-contrast, printed
 * output), not as the card's primary visual definition anymore.
 */
export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-xl border border-border/60 bg-card text-card-foreground shadow-md", className)}>{children}</div>;
}

export function CardHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
      <div>
        <h3 className="text-sm font-semibold text-card-foreground">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function CardBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("px-4 py-3", className)}>{children}</div>;
}

/** A single KPI number card for the dashboard (PRD §6). */
export function StatCard({ label, value, tone = "neutral" }: { label: string; value: string | number; tone?: "neutral" | "warning" | "danger" }) {
  const valueClass = tone === "danger" ? "text-destructive" : tone === "warning" ? "text-warning" : "text-card-foreground";
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold", valueClass)}>{value}</p>
    </Card>
  );
}
