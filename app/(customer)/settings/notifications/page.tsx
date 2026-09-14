import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listNotificationPreferences } from "@/modules/operations/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { MANDATORY_NOTIFICATION_TYPES } from "@/lib/shared/types/operations";

// OPERATIONS-P0-05.1. Bare functional screen — Experience Agent (Module 08)
// owns visual design. All seven P0 notification types are mandatory in
// this build (no optional P0 type exists yet), so every row here is shown
// as locked-on rather than a togglable preference — setNotificationPreference()
// (modules/operations/service.ts) already rejects an attempt to disable
// one; the toggle UI itself has nothing to wire to until an optional
// notification type exists (P1).
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
    <main style={{ maxWidth: 700, margin: "2rem auto", fontFamily: "sans-serif" }}>
      <h1>Notification Preferences</h1>
      <p>Certification, risk and security notifications are mandatory and cannot be turned off.</p>
      <table border={1} cellPadding={6}>
        <thead>
          <tr>
            <th>Type</th>
            <th>In-app</th>
            <th>Email</th>
          </tr>
        </thead>
        <tbody>
          {MANDATORY_NOTIFICATION_TYPES.map((type) => {
            const pref = byType.get(type);
            return (
              <tr key={type}>
                <td>{type}</td>
                <td>
                  <input type="checkbox" checked={pref?.inAppEnabled ?? true} disabled title="Mandatory — cannot be disabled" />
                </td>
                <td>
                  <input type="checkbox" checked={pref?.emailEnabled ?? true} disabled title="Mandatory — cannot be disabled" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
