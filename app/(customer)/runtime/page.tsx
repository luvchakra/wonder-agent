import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listAgents } from "@/modules/agent-identity/service";
import { listRuntimeEvents } from "@/modules/runtime-assurance/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { LinkButton } from "@/modules/ui";
import { RuntimeActivity, type ActivityRow } from "./RuntimeActivity";

const WINDOW_SIZE = 200;

// Composition-only view over Runtime Agent's published listRuntimeEvents()
// and Identity's listAgents(), per EXPERIENCE-P0-03 — Runtime Agent owns
// /runtime/agents/:id (the SHOULD/CAN/DID comparison) itself; this is the
// tenant-wide activity stream the supplied design shows, which had no page
// of its own before (the route was a bare list of agent links).
export default async function RuntimeIndexPage() {
  let ctx;
  try {
    ctx = await requirePermission("runtime.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }

  const tenantId = ctx.tenantId!;
  const [agents, page] = await Promise.all([
    listAgents(tenantId),
    // Server-side limit, per CLAUDE.md §15 — never the whole table.
    listRuntimeEvents(tenantId, { limit: WINDOW_SIZE }),
  ]);

  const nameById = new Map(agents.map((a) => [a.id, a.displayName?.trim() || a.agentName]));
  const rows: ActivityRow[] = page.events.map((e) => ({
    id: e.id,
    agentId: e.agentId,
    agentName: nameById.get(e.agentId) ?? "Unknown agent",
    eventTime: e.eventTime,
    source: e.source,
    action: e.action,
    application: e.application,
    resource: e.resource,
    dataClassification: e.dataClassification,
    success: e.success,
    raw: e.raw,
  }));

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href="/" className="hover:text-foreground hover:underline">
          Dashboard
        </Link>
        <span aria-hidden> / </span>
        <span className="text-foreground">Runtime Assurance</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.01em] text-foreground">Runtime activity</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What your AI agents actually did — the DID half of SHOULD vs CAN vs DID.
          </p>
        </div>
        <LinkButton href="/reports" variant="outline" size="sm">
          Reports &amp; export
        </LinkButton>
      </div>

      <RuntimeActivity rows={rows} windowLabel={`most recent ${WINDOW_SIZE}`} />
    </div>
  );
}
