import { listAnnouncements, listTenants } from "@/modules/platform-admin/service";
import { createAnnouncementAction } from "@/app/actions/platform";

// See app/platform-admin/page.tsx for why this is forced.
export const dynamic = "force-dynamic";

/** PLATFORM-P0-05.4 — Maintenance Mode & Platform Announcements (Platform-admin side). */
export default async function PlatformAnnouncementsPage() {
  const [announcements, tenants] = await Promise.all([listAnnouncements(), listTenants()]);

  return (
    <main>
      <h1>Announcements & Maintenance Windows</h1>

      <h2>Publish a new notice</h2>
      <form action={createAnnouncementAction}>
        <p>
          Scope:{" "}
          <select name="scope" defaultValue="global">
            <option value="global">global</option>
            <option value="tenant">tenant</option>
          </select>
          {" · "}
          Tenant (if scoped):{" "}
          <select name="tenantId">
            <option value="">—</option>
            {tenants.map((t) => (
              <option key={t.tenantId} value={t.tenantId}>
                {t.name}
              </option>
            ))}
          </select>
        </p>
        <p>
          Type:{" "}
          <select name="type" defaultValue="notice">
            <option value="notice">notice</option>
            <option value="maintenance">maintenance</option>
          </select>
        </p>
        <p>
          Title: <input name="title" required />
        </p>
        <p>
          Body: <textarea name="body" required />
        </p>
        <p>
          Ends at (optional, leave blank for open-ended): <input name="endsAt" type="datetime-local" />
        </p>
        <button type="submit">Publish</button>
      </form>

      <h2>All announcements</h2>
      <table border={1} cellPadding={6}>
        <thead>
          <tr>
            <th>Scope</th>
            <th>Type</th>
            <th>Title</th>
            <th>Starts</th>
            <th>Ends</th>
          </tr>
        </thead>
        <tbody>
          {announcements.map((a) => (
            <tr key={a.id}>
              <td>{a.scope === "tenant" ? (tenants.find((t) => t.tenantId === a.tenantId)?.name ?? a.tenantId) : "global"}</td>
              <td>{a.type}</td>
              <td>{a.title}</td>
              <td>{a.startsAt}</td>
              <td>{a.endsAt ?? "open-ended"}</td>
            </tr>
          ))}
          {announcements.length === 0 && (
            <tr>
              <td colSpan={5}>No announcements yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
