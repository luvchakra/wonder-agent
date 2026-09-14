import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/tenant/getTenantContext";
import { search } from "@/modules/operations/service";
import { Card, CardBody, Badge, SeverityBadge, Button, EmptyState, TextField } from "@/modules/ui";

// OPERATIONS-P0-03.1/03.2 — this module's own directly-reachable search
// surface; the shell's ShellGlobalSearch composes the same /api/v1/search
// contract for the in-context modal version.
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const ctx = await getTenantContext();
  if (!ctx.tenantId) redirect("/sign-in");

  const results = q ? await search(ctx.tenantId!, ctx.permissions, q) : [];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-foreground">Search</h1>

      <Card>
        <CardBody>
          <form method="get" className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[16rem]">
              <TextField label="Query" name="q" placeholder="Search agents, findings, policies…" defaultValue={q ?? ""} autoFocus />
            </div>
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </form>
        </CardBody>
      </Card>

      {q && (
        <Card>
          <CardBody>
            {results.length === 0 ? (
              <EmptyState title="No results" description={`Nothing matched "${q}".`} />
            ) : (
              <ul className="divide-y divide-border">
                {results.map((r) => (
                  <li key={`${r.objectType}:${r.id}`} className="flex items-center justify-between gap-2 py-2">
                    <a href={r.href} className="flex-1 text-sm text-primary hover:underline">
                      <Badge tone="neutral">{r.objectType.replace(/_/g, " ")}</Badge> {r.title}
                      {r.subtitle ? <span className="text-muted-foreground"> — {r.subtitle}</span> : null}
                    </a>
                    {r.riskMasked ? (
                      <span className="text-xs text-muted-foreground">risk hidden</span>
                    ) : r.riskSeverity ? (
                      <SeverityBadge severity={r.riskSeverity} />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
