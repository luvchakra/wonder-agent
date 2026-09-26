import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listLifecycleTasks } from "@/modules/agent-identity/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Badge, Card, EmptyState, TableContainer, Td, Th, Thead, Tr } from "@/modules/ui";
import { LIFECYCLE_EVENT_LABEL, LIFECYCLE_TASK_LABEL } from "../labels";

// IDENTITY-P0-18 — the organization's lifecycle work: what joiners,
// movers, leavers and rehires still need, and who it is waiting on.

const VIEWS = [
  { key: "open", label: "Open" },
  { key: "all", label: "All" },
] as const;

export default async function LifecycleWorkPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("identity.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const { status } = await searchParams;
  const view = status === "all" ? "all" : "open";
  const tasks = await listLifecycleTasks(ctx.tenantId!, view === "open" ? { status: "open" } : {}, 200);

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href="/identities" className="hover:text-foreground hover:underline">
          Identities
        </Link>
        <span aria-hidden> / </span>
        <span className="text-foreground">Lifecycle work</span>
      </nav>
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Lifecycle work</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Joiners, movers, leavers and rehires open governed work here. Nothing is granted or removed automatically: each task is done by a
          person and closed with a note, on the person&apos;s Lifecycle tab.
        </p>
      </div>
      <Card className="p-4">
        <nav className="-mx-1 flex gap-1 border-b border-border" aria-label="Task views">
          {VIEWS.map((v) => (
            <Link
              key={v.key}
              href={v.key === "open" ? "/identities/lifecycle" : "/identities/lifecycle?status=all"}
              aria-current={view === v.key ? "page" : undefined}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${view === v.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {v.label}
            </Link>
          ))}
        </nav>
        <div className="mt-4">
          {tasks.length === 0 ? (
            <EmptyState title={view === "open" ? "No open lifecycle work" : "No lifecycle work yet"} description="Tasks appear when a person joins, moves, leaves or returns." />
          ) : (
            <TableContainer label="Lifecycle tasks" bare>
              <Thead>
                <tr>
                  <Th>Person</Th>
                  <Th>Task</Th>
                  <Th hideBelow="lg">Because</Th>
                  <Th hideBelow="xl">For</Th>
                  <Th>Status</Th>
                </tr>
              </Thead>
              <tbody>
                {tasks.map((t) => (
                  <Tr key={t.id}>
                    <Td>
                      <Link href={`/identities/${t.identityId}?tab=lifecycle`} className="font-medium text-primary hover:underline">
                        {t.identityName}
                      </Link>
                    </Td>
                    <Td>{LIFECYCLE_TASK_LABEL[t.taskType]?.title ?? t.taskType}</Td>
                    <Td hideBelow="lg">{LIFECYCLE_EVENT_LABEL[t.eventType] ?? t.eventType}</Td>
                    <Td hideBelow="xl">{t.assigneeName ?? <span className="text-muted-foreground">Identity administrators</span>}</Td>
                    <Td>
                      <Badge tone={t.status === "open" ? "warning" : t.status === "done" ? "success" : "neutral"}>
                        {t.status === "open" ? "Open" : t.status === "done" ? "Done" : "Not needed"}
                      </Badge>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableContainer>
          )}
          {tasks.length >= 200 ? <p className="mt-3 text-xs text-muted-foreground">Showing the latest 200 tasks.</p> : null}
        </div>
      </Card>
    </div>
  );
}
