import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * EXPERIENCE-P0-09. Badge uses CVA (the adopted component technology) but
 * keeps WonderAgent's own risk/status tone vocabulary — success/warning/
 * danger/info/neutral/accent — rather than shadcn's default badge variant
 * names, since this vocabulary is the product's own SHOULD/CAN/DID and
 * severity model (CLAUDE.md §9), not a shadcn concept. "danger" maps to
 * the new `destructive` token internally.
 */
export const badgeVariants = cva("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", {
  variants: {
    tone: {
      neutral: "bg-muted text-muted-foreground border-border",
      success: "bg-success/10 text-success border-success/30",
      warning: "bg-warning/10 text-warning border-warning/30",
      danger: "bg-destructive/10 text-destructive border-destructive/30",
      info: "bg-info/10 text-info border-info/30",
      accent: "bg-accent text-accent-foreground border-accent",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

/**
 * Status/severity indicator. Per docs/design/UI-UX-DESIGN-RULES.md §13/§19:
 * never color alone — every badge carries a text label, never a bare dot.
 */
export function Badge({ tone, className, children }: { tone?: BadgeTone; className?: string; children: React.ReactNode }) {
  return <span className={cn(badgeVariants({ tone }), className)}>{children}</span>;
}

const SEVERITY_TONE: Record<string, BadgeTone> = {
  critical: "danger",
  high: "warning",
  medium: "info",
  low: "neutral",
};

/** Maps WonderAgent's low/medium/high/critical vocabulary to a tone automatically. */
export function SeverityBadge({ severity }: { severity: string }) {
  return <Badge tone={SEVERITY_TONE[severity] ?? "neutral"}>{severity}</Badge>;
}
