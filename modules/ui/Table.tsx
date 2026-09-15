import { cn } from "@/lib/utils";

/**
 * Wide tables scroll within their own container — the page body itself
 * never scrolls horizontally, per docs/design/UI-UX-DESIGN-RULES.md §3/§30.
 * `rounded-2xl border` per 12_ADVANCED_PRODUCT_UX_REQUIREMENTS.md §10's
 * explicit grouped-list container pattern.
 */
export function TableContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
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
