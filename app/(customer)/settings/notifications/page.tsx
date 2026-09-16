import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listNotificationPreferences } from "@/modules/operations/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { MANDATORY_NOTIFICATION_TYPES } from "@/lib/shared/types/operations";
import { Card, CardHeader, CardBody, Badge, TableContainer, Thead, Th, Td, Tr } from "@/modules/ui";

// OPERATIONS-P0-05.1. All seven P0 notification types are mandatory in
// this build (no optional P0 type exists yet), so every row here is shown
// as locked-on rather than a togglable preference — setNotificationPreference()
// already rejects an attempt to disable one; the toggle UI itself has
// nothing to wire to until an optional notification type exists (P1).
// Email delivery (OPERATIONS-P0-02.1, resolved 2026-09-16 via Resend) is
// real now — "Email: On (mandatory)" here means what it says.
export default async function NotificationPreferencesPage() {
  let ctx;
  try {
    ctx = await requirePermission("notification.manage");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }

  const preferences = await listNotificationPreferences(ctx.tenantId!, ctx.userId);
  const byType = new Map(preferences.map((p) => [p.type, p]));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Notification Preferences</h1>
        <p className="mt-1 text-sm text-muted-foreground">Certification, risk and security notifications are mandatory and cannot be turned off.</p>
      </div>

      <Card>
        <CardHeader title="Notification types" />
        <CardBody>
          <TableContainer>
            <Thead>
              <tr>
                <Th>Type</Th>
                <Th>In-app</Th>
                <Th>Email</Th>
              </tr>
            </Thead>
            <tbody>
              {MANDATORY_NOTIFICATION_TYPES.map((type) => {
                const pref = byType.get(type);
                return (
                  <Tr key={type}>
                    <Td>{type.replace(/_/g, " ")}</Td>
                    <Td>
                      <Badge tone={pref?.inAppEnabled ?? true ? "success" : "neutral"}>{pref?.inAppEnabled ?? true ? "On" : "Off"} (mandatory)</Badge>
                    </Td>
                    <Td>
                      <Badge tone={pref?.emailEnabled ?? true ? "success" : "neutral"}>{pref?.emailEnabled ?? true ? "On" : "Off"} (mandatory)</Badge>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </TableContainer>
        </CardBody>
      </Card>
    </div>
  );
}
