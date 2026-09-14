import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { buildDiscoveryInbox } from "@/modules/agent-identity/service";
import { ApiError } from "@/lib/shared/types/foundation";
import type { DiscoveryCategory } from "@/lib/shared/types/agent-identity";
import { Card, CardHeader, CardBody, Badge, EmptyState, TableContainer, Thead, Th, Td, Tr } from "@/modules/ui";

const CATEGORY_LABEL: Record<DiscoveryCategory, string> = {
  new: "New — not yet registered",
  likely_duplicate: "Likely duplicate of an existing agent",
  orphaned_identity: "Orphaned — no live owning agent",
};

const CATEGORY_TONE: Record<DiscoveryCategory, "neutral" | "warning" | "danger"> = {
  new: "neutral",
  likely_duplicate: "warning",
  orphaned_identity: "danger",
};

// IDENTITY-P0-05 — reconciles Integration Agent's imported identity objects
// against Identity's own agents/agent_identities.
export default async function DiscoveryInboxPage() {
  let ctx;
  try {
    ctx = await requirePermission("agent.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }

  const entries = await buildDiscoveryInbox(ctx.tenantId!);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Discovery inbox</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Identities observed through configured integrations, reconciled against already-registered agents. Nothing here is
          fabricated — an empty list means either no integrations are configured yet, or every discovered identity is already
          correlated to a live agent.
        </p>
      </div>

      <Card>
        <CardHeader title="Discovered identities" description={`${entries.length} entr${entries.length === 1 ? "y" : "ies"}`} />
        <CardBody>
          {entries.length === 0 ? (
            <EmptyState title="Nothing to review" />
          ) : (
            <TableContainer>
              <Thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Source</Th>
                  <Th>Category</Th>
                  <Th>Action</Th>
                </tr>
              </Thead>
              <tbody>
                {entries.map((e) => (
                  <Tr key={`${e.integrationId}-${e.externalId}`}>
                    <Td>{e.displayName}</Td>
                    <Td>{e.sourceSystem}</Td>
                    <Td>
                      <Badge tone={CATEGORY_TONE[e.category]}>{CATEGORY_LABEL[e.category]}</Badge>
                    </Td>
                    <Td>
                      {e.category === "likely_duplicate" && e.likelyDuplicateOfAgentId ? (
                        <Link href={`/agents/${e.likelyDuplicateOfAgentId}`} className="text-primary hover:underline">
                          View matched agent
                        </Link>
                      ) : e.category === "new" ? (
                        <Link href="/agents/new" className="text-primary hover:underline">
                          Register
                        </Link>
                      ) : (
                        "—"
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableContainer>
          )}
        </CardBody>
      </Card>

      <Link href="/agents" className="text-sm text-primary hover:underline">
        ← Back to agents
      </Link>
    </div>
  );
}
