/**
 * EXPERIENCE-P0-01.3. Shared empty/error/loading primitives, per
 * docs/design/UI-UX-DESIGN-RULES.md §16 — never a blank screen, never a
 * bare spinner-only page.
 */
export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-6 py-12 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", description, action }: { title?: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-12 text-center">
      <p className="text-sm font-medium text-destructive">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Not-yet-available placeholder — used when a nav target's owning module hasn't shipped a real screen yet. */
export function NotYetAvailable({ feature }: { feature: string }) {
  return <EmptyState title={`${feature} isn't available yet`} description="This area is still being built out." />;
}

export function CardGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-24 animate-pulse rounded-lg border border-border bg-muted" />
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 animate-pulse rounded-md border border-border bg-muted" />
      ))}
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-1/3 animate-pulse rounded-md bg-muted" />
      <div className="h-40 animate-pulse rounded-lg border border-border bg-muted" />
      <div className="h-40 animate-pulse rounded-lg border border-border bg-muted" />
    </div>
  );
}
