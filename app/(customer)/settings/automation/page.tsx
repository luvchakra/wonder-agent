import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { listAssignableRoles } from "@/lib/rbac/roles";
import { listApplicationIdentities, listAutomationCredentials, listGivableRoles, type AutomationCredential } from "@/lib/security/automationCredentials";
import { Badge, Card, CardBody, CardHeader, EmptyState, TableContainer, Td, Th, Thead, Tr, type BadgeTone } from "@/modules/ui";
import { CreateCredentialForm, CredentialManage, PrimaryCredentialAction } from "./AutomationForms";

// FOUNDATION-P0-31 — automation credentials for the administration API
// (design §8.2): a pipeline or an ITSM calls /api/v1/* with one instead of
// a person's session. Created by one administrator, approved by another.

export const metadata = { title: "Automation credentials" };

const STATE: Record<AutomationCredential["state"], { label: string; tone: BadgeTone }> = {
  pending: { label: "Awaiting approval", tone: "warning" },
  active: { label: "Active", tone: "success" },
  expired: { label: "Expired", tone: "neutral" },
  revoked: { label: "Revoked", tone: "danger" },
};

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "Never");

export default async function AutomationCredentialsPage() {
  let ctx;
  try {
    ctx = await requirePermission("automation.manage");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    if (err instanceof ApiError && err.status === 403) redirect("/settings");
    throw err;
  }
  const tenantId = ctx.tenantId!;
  const [credentials, identities, assignable] = await Promise.all([listAutomationCredentials(tenantId), listApplicationIdentities(tenantId), listAssignableRoles(tenantId)]);
  const roles = await listGivableRoles(tenantId, ctx.permissions, assignable);

  return (
    <div className="space-y-5">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Automation credentials</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Let a pipeline or a service call the WonderID API with its own roles. Another administrator approves each one.</p>
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader title={`${credentials.length} credential${credentials.length === 1 ? "" : "s"}`} />
          <CardBody>
            {credentials.length === 0 ? (
              <EmptyState title="No automation credentials" description="Create one for an application identity, then ask another administrator to approve it." />
            ) : (
              <TableContainer>
                <Thead>
                  <tr>
                    <Th>Credential</Th>
                    <Th>State</Th>
                    <Th hideBelow="lg">Expires</Th>
                    <Th hideBelow="lg">Last used</Th>
                    <Th>
                      <span className="sr-only">Action</span>
                    </Th>
                  </tr>
                </Thead>
                <tbody>
                  {credentials.map((c) => (
                    <Tr key={c.id}>
                      <Td>
                        <span className="font-medium text-foreground">{c.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {c.identity.name} · <code>{c.keyPrefix}…</code> · {c.roles.map((r) => r.displayName).join(", ") || "No roles"}
                        </span>
                        <CredentialManage credential={c} roles={roles} />
                      </Td>
                      <Td className="whitespace-nowrap">
                        <Badge tone={STATE[c.state].tone}>{STATE[c.state].label}</Badge>
                        {c.requestedExpiresAt ? <span className="mt-1 block whitespace-normal text-xs text-muted-foreground">Extension to {day(c.requestedExpiresAt)} requested</span> : null}
                      </Td>
                      <Td hideBelow="lg" className="whitespace-nowrap">
                        {day(c.expiresAt)}
                      </Td>
                      <Td hideBelow="lg" className="whitespace-nowrap">
                        {day(c.lastUsedAt)}
                      </Td>
                      <Td>
                        <PrimaryCredentialAction credential={c} viewerId={ctx.userId} />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </TableContainer>
            )}
          </CardBody>
        </Card>
        <Card className="h-fit">
          <CardHeader title="New credential" />
          <CardBody>
            <CreateCredentialForm identities={identities} roles={roles} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
