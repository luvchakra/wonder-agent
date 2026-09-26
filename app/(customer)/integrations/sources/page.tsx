import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { countPendingCorrelations, listIdentitySources, listReconciliationRuns } from "@/modules/integrations/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Badge, Card, EmptyState, LinkButton, TableContainer, Td, Th, Thead, Tr } from "@/modules/ui";
import { RUN_STATUS, TEMPLATE_LABEL } from "./labels";

// INTEGRATION-P0-08 — the organization's identity sources, in precedence order.

export default async function IdentitySourcesPage() {
  let ctx;
  try {
    ctx = await requirePermission("integration.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const tenantId = ctx.tenantId!;
  const [sources, pending] = await Promise.all([listIdentitySources(tenantId), countPendingCorrelations(tenantId)]);
  const lastRuns = await Promise.all(sources.map((s) => listReconciliationRuns(tenantId, s.id, 1).then((r) => r[0] ?? null)));
  const canCreate = ctx.permissions.includes("integration.create");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Identity sources</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Where identities come from: HR files and systems, directories and connected integrations. Each run matches records to identities,
            updates the fields a source owns, and sends anything ambiguous to a person.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <LinkButton href="/integrations/correlations" variant="outline" size="sm">
            Pending matches{pending ? ` (${pending})` : ""}
          </LinkButton>
          {canCreate ? (
            <LinkButton href="/integrations/sources/new" size="sm">
              New source
            </LinkButton>
          ) : null}
        </div>
      </div>

      <Card className="p-4">
        {sources.length === 0 ? (
          <EmptyState
            title="No identity sources yet"
            description={canCreate ? "Add your HR system or a CSV export to bring people into WonderID." : "An integration administrator can add one."}
          />
        ) : (
          <TableContainer label="Identity sources" bare>
            <Thead>
              <tr>
                <Th>Source</Th>
                <Th>Type</Th>
                <Th hideBelow="lg">Precedence</Th>
                <Th hideBelow="xl">Owns</Th>
                <Th>Last run</Th>
              </tr>
            </Thead>
            <tbody>
              {sources.map((s, i) => {
                const run = lastRuns[i];
                return (
                  <Tr key={s.id}>
                    <Td>
                      <Link href={`/integrations/sources/${s.id}`} className="font-medium text-primary hover:underline">
                        {s.name}
                      </Link>
                      <span className="mt-0.5 flex flex-wrap gap-1">
                        {s.authoritative ? <Badge tone="info">Authoritative</Badge> : null}
                        {s.status === "paused" ? <Badge tone="neutral">Paused</Badge> : null}
                      </span>
                    </Td>
                    <Td>{TEMPLATE_LABEL[s.template]}</Td>
                    <Td hideBelow="lg">
                      <span className="tabular-nums">{s.priority}</span>
                    </Td>
                    <Td hideBelow="xl">
                      <span className="text-sm text-muted-foreground">{s.authoritative && s.authoritativeFields.length ? s.authoritativeFields.join(", ") : "Blanks only"}</span>
                    </Td>
                    <Td>
                      {run ? (
                        <Link href={`/integrations/sources/${s.id}/runs/${run.id}`} className="inline-flex items-center gap-2 hover:underline">
                          <Badge tone={RUN_STATUS[run.status].tone}>{RUN_STATUS[run.status].label}</Badge>
                          <span className="text-xs text-muted-foreground">{new Date(run.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">Never run</span>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </TableContainer>
        )}
      </Card>
    </div>
  );
}
