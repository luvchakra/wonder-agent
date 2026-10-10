import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listTenantMembersWithRoles } from "@/lib/rbac/roles";
import { listAuditLogs } from "@/modules/operations/service";
import { SOD_CONFLICT_ACTION, listSoDRules, toSoDConflict } from "@/modules/access-governance/service";
import { listAgents } from "@/modules/agent-identity/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Badge, Card, EmptyState, LinkButton, TableContainer, Td, Th, Thead, Tr } from "@/modules/ui";

// SOD › SoD Conflicts (owner request, 2026-10-10): every conflict an SoD
// rule caught, refused or allowed and recorded, read from the audit trail
// `enforceSoD()` writes (so it needs audit.read). Newest first, a page at a
// time (keyset on the audit time, §15).

const PAGE_SIZE = 50;
const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";

export default async function SoDConflictsPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("audit.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const tenantId = ctx.tenantId!;
  const { before } = await searchParams;
  const cursor = before && !Number.isNaN(Date.parse(before)) ? before : null;
  const canReadPolicies = ctx.permissions.includes("policy.read");
  const [page, members, agents, rules] = await Promise.all([
    listAuditLogs(tenantId, { action: SOD_CONFLICT_ACTION }, cursor, PAGE_SIZE),
    listTenantMembersWithRoles(tenantId),
    listAgents(tenantId),
    canReadPolicies ? listSoDRules(tenantId) : Promise.resolve([]),
  ]);
  const conflicts = page.entries.map(toSoDConflict);
  const person = new Map(members.map((m) => [m.userId, m.displayName || m.email]));
  const agent = new Map(agents.map((a) => [a.id, a.displayName ?? a.agentName]));
  const policy = new Map(rules.map((r) => [r.policyId, r.policyName]));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">SoD Conflicts</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Each time someone tried an action that conflicts with one they had already performed for the same agent.</p>
      </div>
      <Card className="p-4">
        {conflicts.length === 0 ? (
          <EmptyState title={cursor ? "No older conflicts" : "No conflicts recorded"} description={cursor ? "This is the end of the list." : "Conflicts appear here when an SoD rule in effect catches one."} />
        ) : (
          <TableContainer label="SoD conflicts" bare>
            <Thead>
              <tr>
                <Th>When</Th>
                <Th>Person</Th>
                <Th>Tried</Th>
                <Th hideBelow="lg">Already did</Th>
                <Th hideBelow="lg">Agent</Th>
                <Th>Outcome</Th>
                <Th hideBelow="xl">Policy</Th>
              </tr>
            </Thead>
            <tbody>
              {conflicts.map((c) => (
                <Tr key={c.id}>
                  <Td>
                    <span className="whitespace-nowrap text-sm">{fmt(c.at)}</span>
                  </Td>
                  <Td>{c.actorId ? (person.get(c.actorId) ?? "A former member") : "—"}</Td>
                  <Td>
                    <code className="text-xs">{c.attemptedAction ?? "—"}</code>
                  </Td>
                  <Td hideBelow="lg">
                    <code className="text-xs">{c.conflictingAction ?? "—"}</code>
                  </Td>
                  <Td hideBelow="lg">
                    {c.agentId && agent.has(c.agentId) ? (
                      <Link href={`/agents/${c.agentId}`} className="text-primary hover:underline">
                        {agent.get(c.agentId)}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </Td>
                  <Td>
                    <Badge tone={c.blocked ? "danger" : "warning"}>{c.blocked ? "Refused" : "Allowed, recorded"}</Badge>
                  </Td>
                  <Td hideBelow="xl">
                    {c.policyId && policy.has(c.policyId) ? (
                      <Link href={`/policies/${c.policyId}`} className="text-primary hover:underline">
                        {policy.get(c.policyId)}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableContainer>
        )}
        <nav className="mt-3 flex flex-wrap items-center justify-end gap-2 text-sm" aria-label="Pages">
          {cursor ? (
            <LinkButton href="/sod/conflicts" variant="outline" size="sm">
              Newest
            </LinkButton>
          ) : null}
          {page.nextCursor ? (
            <LinkButton href={`/sod/conflicts?before=${encodeURIComponent(page.nextCursor)}`} variant="outline" size="sm">
              Older
            </LinkButton>
          ) : null}
        </nav>
      </Card>
    </div>
  );
}
