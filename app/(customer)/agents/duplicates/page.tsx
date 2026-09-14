import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listDuplicateCandidates } from "@/modules/agent-identity/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { confirmDistinctAction } from "@/app/actions/agents";
import { MergeDuplicateButton } from "./MergeDuplicateButton";
import { Card, CardHeader, CardBody, Button, EmptyState, TableContainer, Thead, Th, Td, Tr } from "@/modules/ui";

// IDENTITY-P0-04 — review inbox for pending registrations that matched an
// existing agent above the duplicate-match threshold.
export default async function DuplicateCandidatesPage() {
  let ctx;
  try {
    ctx = await requirePermission("agent.create");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }

  const candidates = await listDuplicateCandidates(ctx.tenantId!, "pending");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Duplicate registration review</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A pending registration matched an existing agent above the duplicate-match threshold. Confirm they really are the
          same agent (merge — the pending registration is discarded) or that they are genuinely distinct (confirm —
          registration completes now).
        </p>
      </div>

      <Card>
        <CardHeader title="Pending candidates" description={`${candidates.length} pending`} />
        <CardBody>
          {candidates.length === 0 ? (
            <EmptyState title="No pending duplicate candidates" />
          ) : (
            <TableContainer>
              <Thead>
                <tr>
                  <Th>Candidate name</Th>
                  <Th>Matched agent</Th>
                  <Th>Score</Th>
                  <Th>Matched on</Th>
                  <Th>Decision</Th>
                </tr>
              </Thead>
              <tbody>
                {candidates.map((c) => {
                  const candidateName = String((c.candidateData as { agentName?: string }).agentName ?? "(unknown)");
                  const confirmDistinctWithId = confirmDistinctAction.bind(null);
                  return (
                    <Tr key={c.id}>
                      <Td>{candidateName}</Td>
                      <Td>
                        <Link href={`/agents/${c.matchedAgentId}`} className="text-primary hover:underline">
                          {c.matchedAgentId}
                        </Link>
                      </Td>
                      <Td>{c.matchScore}</Td>
                      <Td>{c.matchedKeys.join(", ")}</Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <MergeDuplicateButton candidateId={c.id} candidateName={candidateName} />
                          <form action={confirmDistinctWithId}>
                            <input type="hidden" name="candidateId" value={c.id} />
                            <Button type="submit" variant="secondary" size="sm">
                              Confirm distinct
                            </Button>
                          </form>
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
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
