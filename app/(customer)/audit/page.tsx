import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listAuditLogs } from "@/modules/operations/service";
import { ApiError } from "@/lib/shared/types/foundation";

// Bare functional screen — Experience Agent (Module 08) owns visual design,
// per docs/design/UI-UX-DESIGN-RULES.md. This page is functional scaffolding.
export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  let ctx;
  try {
    ctx = await requirePermission("audit.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }

  const page = await listAuditLogs(
    ctx.tenantId!,
    { objectType: params.objectType, action: params.action, actorId: params.actorId, from: params.from, to: params.to },
    params.cursor ?? null,
  );

  return (
    <main style={{ maxWidth: 1000, margin: "2rem auto", fontFamily: "sans-serif" }}>
      <h1>Audit Trail</h1>
      <p>
        <a href="/api/v1/audit/export?format=csv">Export CSV</a>
      </p>

      <form method="get" style={{ marginBottom: "1rem" }}>
        <input name="objectType" placeholder="object type" defaultValue={params.objectType ?? ""} />
        <input name="action" placeholder="action" defaultValue={params.action ?? ""} />
        <input name="actorId" placeholder="actor id (uuid)" defaultValue={params.actorId ?? ""} />
        <input name="from" type="datetime-local" defaultValue={params.from ?? ""} />
        <input name="to" type="datetime-local" defaultValue={params.to ?? ""} />
        <button type="submit">Filter</button>
      </form>

      <table border={1} cellPadding={6}>
        <thead>
          <tr>
            <th>Time</th>
            <th>Actor</th>
            <th>Action</th>
            <th>Object</th>
            <th>Outcome</th>
          </tr>
        </thead>
        <tbody>
          {page.entries.map((e) => (
            <tr key={e.id}>
              <td>{e.createdAt}</td>
              <td>
                {e.actorType}
                {e.actorId ? `:${e.actorId}` : ""}
              </td>
              <td>{e.action}</td>
              <td>
                {e.objectType}:{e.objectId}
              </td>
              <td>{e.outcome}</td>
            </tr>
          ))}
          {page.entries.length === 0 && (
            <tr>
              <td colSpan={5}>No audit entries match this filter.</td>
            </tr>
          )}
        </tbody>
      </table>

      {page.nextCursor && (
        <p>
          <Link
            href={`/audit?${new URLSearchParams(
              Object.fromEntries(
                Object.entries({ ...params, cursor: page.nextCursor }).filter((entry): entry is [string, string] => entry[1] !== undefined),
              ),
            ).toString()}`}
          >
            Next page →
          </Link>
        </p>
      )}
    </main>
  );
}
