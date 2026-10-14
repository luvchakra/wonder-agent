import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listClassificationRules, listLiveApplications } from "@/modules/access-governance/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Badge, Card, CardBody, CardHeader, EmptyState, TableContainer, Td, Th, Thead, Tr, ObjectActionsMenu } from "@/modules/ui";
import { ClassificationRuleForm } from "./ClassificationForms";

export const metadata = { title: "Classification rules" };

const STATUS = (r: { status: string; publishRequestedBy: string | null; unpublishedChanges: boolean; publishedVersion: number }) =>
  r.status === "retired"
    ? { label: "Retired", tone: "neutral" as const }
    : r.publishRequestedBy
      ? { label: "Waiting for approval", tone: "warning" as const }
      : r.status === "published"
        ? r.unpublishedChanges
          ? { label: `v${r.publishedVersion} live · changes not published`, tone: "info" as const }
          : { label: `v${r.publishedVersion} live`, tone: "success" as const }
        : { label: "Draft", tone: "neutral" as const };

// ACCESS-P0-33 — classify imported entitlements by rule: privilege, data
// classification, type, requestable, SOX. A person's own value always stays.
export default async function ClassificationRulesPage() {
  let ctx;
  try {
    ctx = await requirePermission("access.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const tenantId = ctx.tenantId!;
  const canManage = ctx.permissions.includes("access.manage");
  const [rules, applications] = await Promise.all([listClassificationRules(tenantId), canManage ? listLiveApplications(tenantId) : Promise.resolve([])]);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Classification rules</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Classify entitlements as they arrive. A value a person set is never changed by a rule.</p>
        </div>
        <ObjectActionsMenu create={canManage ? { label: "New rule…", title: "New rule", content: <ClassificationRuleForm applications={applications} /> } : undefined} />
      </div>
      <Card>
        <CardHeader title="Rules" description={`${rules.filter((r) => r.status === "published").length} published`} />
        <CardBody>
          {rules.length === 0 ? (
            <EmptyState title="No rules yet" description={canManage ? "Create the first one from Actions." : "An access administrator can add them."} />
          ) : (
            <TableContainer label="Classification rules" bare>
              <Thead>
                <tr>
                  <Th>Rule</Th>
                  <Th>Status</Th>
                </tr>
              </Thead>
              <tbody>
                {rules.map((r) => {
                  const status = STATUS(r);
                  return (
                    <Tr key={r.id}>
                      <Td>
                        <Link href={`/access/classification-rules/${r.ref ?? r.id}`} className="font-medium text-primary hover:underline">
                          {r.name}
                        </Link>
                        <span className="block text-xs text-muted-foreground">
                          Sets {r.effects.map((e) => String(e.params.attribute)).join(", ")} · {r.mode === "enforce" ? "Enforce" : "Report only"}
                        </span>
                      </Td>
                      <Td>
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </TableContainer>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
