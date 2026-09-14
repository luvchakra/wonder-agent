/**
 * Wide tables scroll within their own container — the page body itself
 * never scrolls horizontally, per docs/design/UI-UX-DESIGN-RULES.md §3/§30.
 */
export function TableContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-full text-left text-sm">{children}</table>
    </div>
  );
}

export function Thead({ children }: { children: React.ReactNode }) {
  return <thead className="border-b border-border bg-surface-elevated text-xs uppercase tracking-wide text-text-muted">{children}</thead>;
}

export function Th({ children, ...rest }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th className="px-4 py-2 font-medium whitespace-nowrap" {...rest}>
      {children}
    </th>
  );
}

export function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-2 text-text-primary ${className}`}>{children}</td>;
}

export function Tr({ children }: { children: React.ReactNode }) {
  return <tr className="border-b border-border last:border-0 hover:bg-surface-elevated/60">{children}</tr>;
}
