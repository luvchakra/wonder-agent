import { launchFromTemplateAction } from "@/app/actions/compliance";
import { Button, Card, CardHeader } from "@/modules/ui";
import type { CampaignTemplate } from "@/modules/certification-compliance/service";

const SCOPE_LABEL: Record<string, string> = { identity_access: "people's access", role_assignments: "WonderID roles", package_contents: "access packages", application_contents: "applications" };

/** COMPLIANCE-P0-14: saved launches; one action each (§19.5). */
export function CampaignTemplatesList({ templates }: { templates: CampaignTemplate[] }) {
  return (
    <Card>
      <CardHeader title="Templates" />
      <ul className="divide-y divide-border">
        {templates.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">{t.name}</span>
              <span className="block text-xs text-muted-foreground">
                {SCOPE_LABEL[t.scopeType] ?? t.scopeType}
                {t.scope.privilegedOnly ? " · privileged only" : ""}
                {t.dueInDays ? ` · ${t.dueInDays} days to review` : ""}
              </span>
            </span>
            <form action={launchFromTemplateAction.bind(null, t.id)}>
              <Button type="submit" variant="secondary" size="sm">
                Launch
              </Button>
            </form>
          </li>
        ))}
      </ul>
    </Card>
  );
}
