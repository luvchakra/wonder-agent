import Link from "next/link";
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
  // `flex flex-col` so a card placed in a stretched grid row can hand the
  // spare height to a body marked `flex-1` instead of leaving a dead gap
  // under its content. Cards that do not opt in look exactly as before.
  return (
    <div className={cn("flex flex-col rounded-xl border border-border/60 bg-card text-card-foreground shadow-md", className)}>
      {children}
    </div>
  );
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

/**
 * A single KPI number card for the dashboard (PRD §6). `href`, when
 * given, makes the card a link with a small arrow affordance per
 * 12_ADVANCED_PRODUCT_UX_REQUIREMENTS.md §36's explicit acceptance
 * criterion ("Clickable cards must have a small arrow affordance").
 */
export function StatCard({
  label,
  value,
  tone = "neutral",
  href,
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "warning" | "danger";
  href?: string;
}) {
  const valueClass = tone === "danger" ? "text-destructive" : tone === "warning" ? "text-warning" : "text-card-foreground";
  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {href && (
          <span aria-hidden className="text-muted-foreground">
            →
          </span>
        )}
      </div>
      <p className={cn("mt-1 text-2xl font-semibold", valueClass)}>{value}</p>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="block rounded-xl border border-border/60 bg-card p-4 text-card-foreground shadow-md transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      >
        {content}
      </Link>
    );
  }

  return <Card className="p-4">{content}</Card>;
}
