import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listIdentitySources, listPendingCorrelations } from "@/modules/integrations/service";
import { getIdentityNames } from "@/modules/agent-identity/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Card, EmptyState } from "@/modules/ui";
import { CorrelationDecision } from "../sources/SourceForms";
import { TARGET_LABEL } from "../sources/labels";

// INTEGRATION-P0-09 — source records that matched more than one identity.
// Nothing happens to them until a person decides (§17.6).

export default async function PendingCorrelationsPage() {
  let ctx;
  try {
    ctx = await requirePermission("integration.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const tenantId = ctx.tenantId!;
  const [pending, sources] = await Promise.all([listPendingCorrelations(tenantId), listIdentitySources(tenantId)]);
  const names = await getIdentityNames(tenantId, pending.flatMap((p) => p.candidateIdentityIds));
  const sourceName = new Map(sources.map((s) => [s.id, s.name]));
  const canResolve = ctx.permissions.includes("identity.manage");

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
                            <Link href={`/identities/${id}`} className="text-primary hover:underline">
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
    </div>
  );
}
