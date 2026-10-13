import { listAnnouncements, listTenants } from "@/modules/platform-admin/service";
import { createAnnouncementAction, endAnnouncementAction } from "@/app/actions/platform";
import { Badge, Button, Card, CardBody, CardHeader, TableContainer, Td, Th, Thead, Tr, fieldInputClass, fieldLabelClass } from "@/modules/ui";
import { PageHeading } from "../PageHeading";

// See app/platform-admin/page.tsx for why this is forced.
export const dynamic = "force-dynamic";

/** The notices whose end has passed, read once per request. */
function endedIds(list: { id: string; endsAt: string | null }[], now = new Date()): Set<string> {
  return new Set(list.filter((a) => a.endsAt && new Date(a.endsAt) <= now).map((a) => a.id));
}

/** PLATFORM-P0-05.4 — Maintenance Mode & Platform Announcements (Platform-admin side). */
export default async function PlatformAnnouncementsPage() {
  const [announcements, tenants] = await Promise.all([listAnnouncements(), listTenants()]);
  const tenantName = new Map(tenants.map((t) => [t.tenantId, t.name ?? t.tenantId]));
  const ended = endedIds(announcements);

  return (
    <>
      <PageHeading title="Announcements" description="Notices and maintenance windows shown to customers." />

      <Card>
        <CardHeader title="Publish a notice" />
        <CardBody>
          <form action={createAnnouncementAction} className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="scope" className={fieldLabelClass}>
                Scope
              </label>
              <select id="scope" name="scope" defaultValue="global" className={fieldInputClass}>
                <option value="global">Everyone</option>
                <option value="tenant">One organization</option>
              </select>
            </div>
            <div>
              <label htmlFor="tenantId" className={fieldLabelClass}>
                Organization (one organization only)
              </label>
              <select id="tenantId" name="tenantId" className={fieldInputClass}>
                <option value="">—</option>
                {tenants.map((t) => (
                  <option key={t.tenantId} value={t.tenantId}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="type" className={fieldLabelClass}>
                Type
              </label>
              <select id="type" name="type" defaultValue="notice" className={fieldInputClass}>
                <option value="notice">Notice</option>
                <option value="maintenance">Maintenance</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="title" className={fieldLabelClass}>
                Title
              </label>
              <input id="title" name="title" required className={fieldInputClass} />
            </div>
            <div>
              <label htmlFor="endsAt" className={fieldLabelClass}>
                Ends (optional)
              </label>
              <input id="endsAt" name="endsAt" type="datetime-local" className={fieldInputClass} />
            </div>
            <div className="sm:col-span-3">
              <label htmlFor="body" className={fieldLabelClass}>
                Message
              </label>
              <textarea id="body" name="body" required rows={3} className={fieldInputClass} />
            </div>
            <div className="sm:col-span-3">
              <Button type="submit">Publish</Button>
            </div>
          </form>
        </CardBody>
      </Card>

      {announcements.length === 0 ? (
        <p className="text-sm text-muted-foreground">No announcements yet.</p>
      ) : (
        <Card>
          <TableContainer label="Announcements" bare>
            <Thead>
              <tr>
                <Th>Title</Th>
                <Th>Type</Th>
                <Th>Scope</Th>
                <Th hideBelow="lg">Starts</Th>
                <Th hideBelow="lg">Ends</Th>
                <Th className="text-right">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </Thead>
            <tbody>
              {announcements.map((a) => (
                <Tr key={a.id}>
                  <Td className="font-medium">{a.title}</Td>
                  <Td>
                    <Badge tone={a.type === "maintenance" ? "warning" : "info"} className="capitalize">
                      {a.type}
                    </Badge>
                  </Td>
                  <Td>{a.scope === "tenant" ? (tenantName.get(a.tenantId ?? "") ?? a.tenantId) : "Everyone"}</Td>
                  <Td hideBelow="lg" className="text-muted-foreground">
                    {new Date(a.startsAt).toLocaleString()}
                  </Td>
                  <Td hideBelow="lg" className="text-muted-foreground">
                    {a.endsAt ? new Date(a.endsAt).toLocaleString() : "Open-ended"}
                  </Td>
                  <Td className="text-right">
                    {/* Owner request 2026-10-13: end a notice by hand. */}
                    {!ended.has(a.id) ? (
                      <form action={endAnnouncementAction.bind(null, a.id)}>
                        <Button type="submit" size="sm" variant="outline" aria-label={`End ${a.title} now`}>
                          End now
                        </Button>
                      </form>
                    ) : (
                      <span className="text-xs text-muted-foreground">Ended</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableContainer>
        </Card>
      )}
    </>
  );
}
