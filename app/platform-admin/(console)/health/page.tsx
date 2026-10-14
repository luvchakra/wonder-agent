import { getPlatformHealth, getWonderappsDashboardAccess } from "@/modules/platform-admin/service";
import { setWonderappsAccessAction } from "@/app/actions/platform";
import { Card, CardBody, CardHeader, PendingSubmitButton, StatusBadge } from "@/modules/ui";
import { HealthSignals, PageHeading } from "@/app/platform-admin/PageHeading";

// See app/platform-admin/page.tsx for why this is forced.
export const dynamic = "force-dynamic";

export default async function PlatformHealthPage() {
  const [health, wonderapps] = await Promise.all([getPlatformHealth(), getWonderappsDashboardAccess()]);

  return (
    <>
      <PageHeading title="Platform Health" />
      <Card>
        <CardHeader title="Signals" />
        <HealthSignals health={health} />
      </Card>

      {/* Owner decision (2026-10-13): WonderApps reads across organizations only while this is on. */}
      <Card>
        <CardHeader
          title="WonderApps dashboard access"
          description="Every change is recorded in the platform audit log."
          actions={wonderapps === null ? <StatusBadge tone="warning">Unavailable</StatusBadge> : <StatusBadge tone={wonderapps ? "success" : "neutral"}>{wonderapps ? "On" : "Off"}</StatusBadge>}
        />
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {wonderapps === null
              ? "The current state could not be read."
              : wonderapps
                ? "The WonderApps dashboard can read WonderID data across all organizations (never the AI provider keys)."
                : "The WonderApps dashboard cannot read any WonderID data."}
          </p>
          {wonderapps === null ? null : (
            <form action={setWonderappsAccessAction}>
              <input type="hidden" name="enabled" value={wonderapps ? "false" : "true"} />
              <PendingSubmitButton variant={wonderapps ? "outline" : "default"} size="sm" pendingLabel="Saving…">
                {wonderapps ? "Turn off WonderApps access" : "Turn on WonderApps access"}
              </PendingSubmitButton>
            </form>
          )}
        </CardBody>
      </Card>
    </>
  );
}
