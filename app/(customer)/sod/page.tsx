import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listSoDRules } from "@/modules/access-governance/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Badge, Card, EmptyState, TableContainer, Td, Th, Thead, Tr } from "@/modules/ui";

// SOD › SoD Rules (owner request, 2026-10-10): the separation-of-duties
// rules WonderID enforces (ACCESS-P0-14), read from the identity policies
// that hold them. A rule is added or changed on its policy's page.

const STATUS: Record<string, { label: string; tone: "success" | "warning" | "neutral" }> = {
  active: { label: "In effect", tone: "success" },
  draft: { label: "Draft", tone: "warning" },
};

export default async function SoDRulesPage() {
  let ctx;
  try {
    ctx = await requirePermission("policy.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const rules = await listSoDRules(ctx.tenantId!);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">SoD Rules</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Actions one person must not both perform for the same agent. Add or change a rule on its{" "}
          <Link href="/policies" className="text-primary hover:underline">
            identity policy
          </Link>
          .
        </p>
      </div>
      <Card className="p-4">
        {rules.length === 0 ? (
          <EmptyState title="No SoD rules yet" description="Add a rule with conflicting actions to an identity policy; it is enforced once the policy is in effect." />
        ) : (
          <TableContainer label="SoD rules" bare>
            <Thead>
              <tr>
                <Th>Conflicting actions</Th>
                <Th>Policy</Th>
                <Th>When it conflicts</Th>
                <Th hideBelow="lg">Status</Th>
              </tr>
            </Thead>
            <tbody>
              {rules.map((r) => {
                const status = STATUS[r.policyStatus] ?? { label: "Not in effect", tone: "neutral" as const };
                return (
                  <Tr key={r.ruleId}>
                    <Td>
                      <span className="flex flex-wrap gap-1">
                        {r.conflictingActions.map((a) => (
                          <code key={a} className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">
                            {a}
                          </code>
                        ))}
                      </span>
                    </Td>
                    <Td>
                      <Link href={`/policies/${r.policyId}`} className="text-primary hover:underline">
                        {r.policyName}
                      </Link>
                    </Td>
                    <Td>
                      <Badge tone={r.blocking ? "danger" : "warning"}>{r.blocking ? "Refused" : "Allowed, recorded"}</Badge>
                    </Td>
                    <Td hideBelow="lg">
                      <Badge tone={status.tone}>{status.label}</Badge>
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
