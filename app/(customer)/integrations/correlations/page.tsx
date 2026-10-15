import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getIdentitySourceNames, listPendingCorrelations } from "@/modules/integrations/service";
import { getIdentityNames, listSourceDisagreements } from "@/modules/agent-identity/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Card, EmptyState } from "@/modules/ui";
import { CorrelationDecision } from "../sources/SourceForms";
import { TARGET_LABEL } from "../sources/labels";

// INTEGRATION-P0-09 — source records that matched more than one identity.
// Nothing happens to them until a person decides (§17.6).
// WID-H01 (owner decision): below them, folded, the fields two sources
// disagree on. The higher-priority source's value stays; this is for review.

export default async function PendingCorrelationsPage() {
  let ctx;
  try {
    ctx = await requirePermission("integration.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const tenantId = ctx.tenantId!;
  const [pending, disagreements] = await Promise.all([listPendingCorrelations(tenantId), listSourceDisagreements(tenantId)]);
  // Names for the sources shown here only: an organization may have more sources than one list page holds.
  const sourceIds = [...pending.map((p) => p.sourceId), ...disagreements.flatMap((d) => [d.otherSourceId, ...(d.keptSourceId ? [d.keptSourceId] : [])])];
  const [names, sourceName] = await Promise.all([getIdentityNames(tenantId, pending.flatMap((p) => p.candidateIdentityIds)), getIdentitySourceNames(tenantId, sourceIds)]);
  const canResolve = ctx.permissions.includes("identity.manage");
  const fieldLabel = (f: string) => (f.startsWith("attributes.") ? f.slice("attributes.".length) : (TARGET_LABEL[f as keyof typeof TARGET_LABEL] ?? f));

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href="/integrations/sources" className="hover:text-foreground hover:underline">
          Identity sources
        </Link>
        <span aria-hidden> / </span>
        <span className="text-foreground">Pending matches</span>
      </nav>
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Pending matches</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Source records that match more than one identity. WonderID never picks one for you: link the record to the right identity, create a
          new one, or dismiss it.
        </p>
      </div>
      {pending.length === 0 ? (
        <Card className="p-4">
          <EmptyState title="Nothing to decide" description="Every source record matched one identity or none." />
        </Card>
      ) : (
        <ul className="space-y-3">
          {pending.map((p) => {
            const fields = Object.entries(p.normalized).filter(([, v]) => v !== null && v !== "");
            return (
              <li key={p.id}>
                <Card className="p-4">
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_20rem]">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">{String(p.normalized.displayName ?? p.externalId)}</p>
                      <p className="text-xs text-muted-foreground">
                        {sourceName.get(p.sourceId) ?? "A source"} · record <span className="font-mono">{p.externalId}</span> · {p.reason}
                      </p>
                      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
                        {fields.map(([k, v]) => (
                          <div key={k} className="flex min-w-0 gap-2">
                            <dt className="shrink-0 text-muted-foreground">{TARGET_LABEL[k as keyof typeof TARGET_LABEL] ?? k}</dt>
                            <dd className="truncate text-foreground">{String(v)}</dd>
                          </div>
                        ))}
                      </dl>
                      <p className="mt-3 text-xs font-medium text-muted-foreground">Candidates</p>
                      <ul className="mt-1 flex flex-wrap gap-2 text-sm">
                        {p.candidateIdentityIds.map((id) => (
                          <li key={id}>
                            <Link href={`/identities/${names.get(id)?.ref ?? id}`} className="text-primary hover:underline">
                              {names.get(id)?.displayName ?? "Unknown identity"} <span className="font-mono text-xs text-muted-foreground">{id.slice(0, 8)}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <CorrelationDecision
                      pendingId={p.id}
                      canResolve={canResolve}
                      candidates={p.candidateIdentityIds.map((id) => ({ id, label: `${names.get(id)?.displayName ?? "Unknown"} · ${id.slice(0, 8)}` }))}
                    />
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      <details className="group rounded-lg border border-border bg-card" data-testid="source-disagreements">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground">
          Disagreements between sources <span className="text-muted-foreground">({disagreements.length})</span>
        </summary>
        <div className="border-t border-border px-4 py-3">
          {disagreements.length === 0 ? (
            <p className="text-sm text-muted-foreground">Every source agrees on the fields it owns.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {disagreements.map((d) => (
                <li key={d.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-baseline sm:gap-3">
                  <Link href={`/identities/${d.identityRef ?? d.identityId}`} className="shrink-0 font-medium text-primary hover:underline">
                    {d.displayName}
                  </Link>
                  <span className="shrink-0 text-muted-foreground">{fieldLabel(d.field)}</span>
                  <span className="min-w-0 break-words text-foreground">
                    {d.keptValue ?? "(blank)"} <span className="text-muted-foreground">from {(d.keptSourceId && sourceName.get(d.keptSourceId)) ?? "a source"}, kept</span>
                    <span className="text-muted-foreground"> · </span>
                    {d.otherValue ?? "(blank)"} <span className="text-muted-foreground">from {sourceName.get(d.otherSourceId) ?? "a source"}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </div>
  );
}
