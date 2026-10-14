import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getOnboardingTemplate } from "@/modules/access-governance/service";
import { listAccountableHumans } from "@/modules/agent-identity/service";
import { listConnectorDefinitions } from "@/modules/integrations/framework/catalog";
import { ApiError } from "@/lib/shared/types/foundation";
import { Badge, Card, CardBody, CardHeader } from "@/modules/ui";
import { RetireTemplate, TemplateForm } from "../TemplateForms";
import { questionsText } from "../format";

export const metadata = { title: "Onboarding template" };

// ACCESS-P0-34 — one onboarding template: edit it, or retire it (onboardings that used it keep it).
export default async function OnboardingTemplatePage({ params }: { params: Promise<{ templateId: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("access.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const { templateId } = await params;
  const tenantId = ctx.tenantId!;
  const canManage = ctx.permissions.includes("access.manage");
  const [template, types, people] = await Promise.all([
    getOnboardingTemplate(tenantId, templateId),
    listConnectorDefinitions(tenantId),
    canManage ? listAccountableHumans(tenantId) : Promise.resolve([]),
  ]);
  if (!template) notFound();
  const editable = canManage && template.status === "active";
  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href="/access/onboarding-templates" className="hover:text-foreground hover:underline">
          Onboarding templates
        </Link>
        <span aria-hidden> / </span>
        <span className="text-foreground">{template.name}</span>
      </nav>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="break-words text-[22px] font-semibold tracking-[-0.015em] text-foreground">{template.name}</h1>
        <Badge tone={template.status === "active" ? "success" : "neutral"}>{template.status === "active" ? "In use" : "Retired"}</Badge>
      </div>
      <Card>
        <CardHeader title="Template" description={template.description ?? undefined} />
        <CardBody>
          {editable ? (
            <TemplateForm template={template} connectionTypes={types.map((t) => ({ id: t.key, name: t.name }))} people={people.map((p) => ({ id: p.id, name: p.displayName }))} />
          ) : (
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Connection type</dt>
                <dd className="text-foreground">{template.connectionTypeKey ?? "Any application"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Entitlement types</dt>
                <dd className="text-foreground">{template.entitlementTypes.map((t) => t.name).join(", ") || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Questionnaire</dt>
                <dd className="whitespace-pre-line text-foreground">{questionsText(template.questions) || "—"}</dd>
              </div>
            </dl>
          )}
        </CardBody>
      </Card>
      {editable ? (
        <details className="rounded-lg border border-border bg-card p-4">
          <summary className="cursor-pointer text-sm font-medium text-foreground">Retire</summary>
          <p className="mt-2 text-xs text-muted-foreground">It is no longer offered. Onboardings that started from it keep it.</p>
          <div className="mt-3">
            <RetireTemplate templateId={template.id} />
          </div>
        </details>
      ) : null}
    </div>
  );
}
