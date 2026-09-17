import { cn } from "@/lib/utils";

/**
 * Wide tables scroll within their own container — the page body itself
 * never scrolls horizontally, per docs/design/UI-UX-DESIGN-RULES.md §3/§30.
 * `rounded-2xl border` per 12_ADVANCED_PRODUCT_UX_REQUIREMENTS.md §10's
 * explicit grouped-list container pattern.
 *
 * The scroll region is declared rather than implicit: `role="region"` with
 * a name and `tabIndex={0}` means a keyboard user can actually reach and
 * scroll it, and a screen reader announces that there is more table than
 * fits. Without those, a table wider than a phone is simply unreachable
 * without a pointer.
 *
 * This is the fallback for screens that still render a raw table. The
 * design's own pattern below `md` is a card list, which `DataTable`
 * implements (pass `renderCard` for a designed row) — prefer that for any
 * new list screen.
 */
export function TableContainer({ children, label = "Table" }: { children: React.ReactNode; label?: string }) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="overflow-x-auto rounded-2xl border border-border focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
    >
      <table className="w-full min-w-full text-left text-sm">{children}</table>
    </div>
  );
}

export function Thead({ children }: { children: React.ReactNode }) {
  return <thead className="border-b border-border bg-muted text-xs uppercase tracking-wide text-muted-foreground">{children}</thead>;
}

export function Th({ children, className, ...rest }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th className={cn("px-4 py-2 font-medium whitespace-nowrap", className)} {...rest}>
      {children}
    </th>
  );
}

export function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn("px-4 py-2 text-foreground", className)}>{children}</td>;
}

export function Tr({ children }: { children: React.ReactNode }) {
  return <tr className="border-b border-border last:border-0 hover:bg-muted/60">{children}</tr>;
}
