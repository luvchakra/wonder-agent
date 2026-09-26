import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listApplicationsForMatching, listEntitlementsForApplication, listRequestPolicies } from "@/modules/access-governance/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, SelectField, TableContainer, Td, Th, Thead, Tr } from "@/modules/ui";
import { PolicyForm } from "./PolicyForm";

// ACCESS-P0-18 — request policies (spec §11.4): who may request what, for
// whom, for how long, with what justification, and when a person must
// approve. The most specific active policy applies.

const FOR_OTHERS: Record<string, string> = { none: "Self only", managers: "Manager or access manager", access_managers: "Access managers" };
const APPROVAL: Record<string, string> = { manager_approval: "Manager", owner_approval: "Owner", manager_and_owner: "Manager and owner" };

export default async function RequestPoliciesPage({ searchParams }: { searchParams: Promise<{ app?: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("access.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const tenantId = ctx.tenantId!;
  const canManage = ctx.permissions.includes("access.manage");
  const sp = await searchParams;
  const [policies, apps] = await Promise.all([listRequestPolicies(tenantId), canManage ? listApplicationsForMatching(tenantId) : Promise.resolve([])]);
  const selectedApp = apps.find((a) => a.id === sp.app) ?? null;
  const entitlements = selectedApp ? await listEntitlementsForApplication(tenantId, selectedApp.id) : [];
  const existing = policies.find((p) => (selectedApp ? p.applicationId === selectedApp.id && !p.entitlementId : !p.applicationId));
  const defaults = existing ?? {
    name: selectedApp ? `${selectedApp.displayName ?? selectedApp.name} requests` : "Organization default",
    requestable: true,
    allowSelf: true,
    allowForOthers: "managers",
    maxDurationDays: 90,
    defaultDurationDays: 30,
    justificationRequired: true,
    riskThreshold: "high",
    autoApprove: false,
    approval: "manager_approval",
    approvalMode: "sequential",
    approvalTimeoutDays: 5,
    onTimeout: "escalate",
    status: "active",
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Request policies</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          What people can request and on what terms. An entitlement&apos;s policy wins over its application&apos;s, which wins over the organization default. Without any policy, nothing is requestable.
        </p>
      </div>

      <Card className="p-4">
        {policies.length === 0 ? (
          <EmptyState title="No request policies yet" description="Nothing is requestable until a policy says so." />
        ) : (
          <TableContainer label="Request policies" bare>
            <Thead>
              <tr>
                <Th>Policy</Th>
                <Th>Applies to</Th>
                <Th hideBelow="lg">For others</Th>
                <Th hideBelow="lg">Duration</Th>
                <Th hideBelow="xl">Approval</Th>
                <Th>Status</Th>
              </tr>
            </Thead>
            <tbody>
              {policies.map((p) => (
                <Tr key={p.id}>
                  <Td>
                    <span className="font-medium text-foreground">{p.name}</span>
                    <span className="mt-0.5 flex flex-wrap gap-1">
                      {!p.requestable ? <Badge tone="neutral">Not requestable</Badge> : null}
                      {p.autoApprove ? <Badge tone="info">Auto-approves below {p.riskThreshold}</Badge> : null}
                      {p.justificationRequired ? null : <Badge tone="neutral">No justification</Badge>}
                    </span>
                  </Td>
                  <Td>{p.entitlementName ? `${p.applicationName} — ${p.entitlementName}` : (p.applicationName ?? "Organization default")}</Td>
                  <Td hideBelow="lg">{FOR_OTHERS[p.allowForOthers]}</Td>
                  <Td hideBelow="lg">{p.maxDurationDays ? `Up to ${p.maxDurationDays} days` : "No limit"}</Td>
                  <Td hideBelow="xl">
                    {APPROVAL[p.approval]}
                    {p.approval === "manager_and_owner" ? <span className="block text-xs text-muted-foreground">{p.approvalMode === "parallel" ? "at the same time" : "in order"}</span> : null}
                    <span className="block text-xs text-muted-foreground">
                      {p.approvalTimeoutDays} days each, then {p.onTimeout === "escalate" ? "escalate" : "expire"}
                    </span>
                  </Td>
                  <Td>
                    <Badge tone={p.status === "active" ? "success" : "neutral"} className="whitespace-nowrap">{p.status === "active" ? "Active" : "Inactive"}</Badge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableContainer>
        )}
      </Card>

      {canManage ? (
        <Card>
          <CardHeader title="Set a policy" description="Choose where it applies. Saving replaces the policy already set for that scope." />
          <CardBody className="space-y-5">
            <form method="get" className="flex flex-wrap items-end gap-2">
              <div className="min-w-[14rem] flex-1">
                <SelectField label="Scope" name="app" defaultValue={selectedApp?.id ?? ""}>
                  <option value="">Organization default</option>
                  {apps
                    .slice()
                    .sort((a, b) => (a.displayName ?? a.name).localeCompare(b.displayName ?? b.name))
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.displayName ?? a.name}
                      </option>
                    ))}
                </SelectField>
              </div>
              <Button type="submit" variant="secondary">
                Choose
              </Button>
            </form>
            <PolicyForm key={selectedApp?.id ?? "default"} applicationId={selectedApp?.id ?? null} entitlements={entitlements.map((e) => ({ id: e.id, name: e.name }))} defaults={defaults} />
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
