import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listOnboardingTemplates } from "@/modules/access-governance/service";
import { listAccountableHumans } from "@/modules/agent-identity/service";
import { listConnectorDefinitions } from "@/modules/integrations/framework/catalog";
import { ApiError } from "@/lib/shared/types/foundation";
import { Card, CardBody, CardHeader, EmptyState, TableContainer, Td, Th, Thead, Tr, ObjectActionsMenu } from "@/modules/ui";
import { TemplateForm } from "./TemplateForms";

export const metadata = { title: "Onboarding templates" };

// ACCESS-P0-34 — starting points for onboarding applications, per connection
// type: defaults, owners, entitlement types and a questionnaire.
export default async function OnboardingTemplatesPage() {
  let ctx;
  try {
    ctx = await requirePermission("access.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const tenantId = ctx.tenantId!;
  const canManage = ctx.permissions.includes("access.manage");
  const [templates, types, people] = await Promise.all([listOnboardingTemplates(tenantId), listConnectorDefinitions(tenantId), canManage ? listAccountableHumans(tenantId) : Promise.resolve([])]);
  const typeName = new Map(types.map((t) => [t.key, t.name]));
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Onboarding templates</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Start onboarding an application with its defaults, owners, entitlement types and questions already set.</p>
        </div>
        <ObjectActionsMenu
          create={
            canManage
              ? {
                  label: "New template…",
                  title: "New template",
                  content: <TemplateForm connectionTypes={types.map((t) => ({ id: t.key, name: t.name }))} people={people.map((p) => ({ id: p.id, name: p.displayName }))} />,
                }
              : undefined
          }
        />
      </div>
      <Card>
        <CardHeader title="Templates" description={`${templates.length} in use`} />
        <CardBody>
          {templates.length === 0 ? (
            <EmptyState title="No templates yet" description={canManage ? "Add the first one from Actions." : "An access administrator can add them."} />
          ) : (
            <TableContainer label="Onboarding templates" bare>
              <Thead>
                <tr>
                  <Th>Template</Th>
                  <Th>Connection type</Th>
                </tr>
              </Thead>
              <tbody>
                {templates.map((t) => (
                  <Tr key={t.id}>
                    <Td>
                      <Link href={`/access/onboarding-templates/${t.ref ?? t.id}`} className="font-medium text-primary hover:underline">
                        {t.name}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {t.questions.length} question{t.questions.length === 1 ? "" : "s"} · {t.entitlementTypes.length} entitlement type{t.entitlementTypes.length === 1 ? "" : "s"}
                      </span>
                    </Td>
                    <Td>{t.connectionTypeKey ? (typeName.get(t.connectionTypeKey) ?? t.connectionTypeKey) : "Any application"}</Td>
                  </Tr>
                ))}
              </tbody>
            </TableContainer>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
