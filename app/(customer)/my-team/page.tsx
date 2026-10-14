import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getIdentityForUser, listDirectReports } from "@/modules/agent-identity/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Badge, Card, CardBody, CardHeader, EmptyState } from "@/modules/ui";
import { DisableAllAccess } from "./DisableAllAccess";

export const metadata = { title: "My team" };

const STATE: Record<string, { label: string; tone: "success" | "warning" | "neutral" }> = {
  ACTIVE: { label: "Working", tone: "success" },
  LEAVE_PENDING: { label: "Leaving", tone: "warning" },
  PRE_JOIN: { label: "Starting", tone: "neutral" },
};

// IDENTITY-P0-18 (finish) — a manager's direct reports, with the one
// emergency action a manager has on them: stop all their access at once.
export default async function MyTeamPage() {
  let ctx;
  try {
    ctx = await requirePermission("access.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const tenantId = ctx.tenantId!;
  const me = await getIdentityForUser(tenantId, ctx.userId);
  const reports = await listDirectReports(tenantId, me?.id ?? null);
  const canDisable = ctx.permissions.includes("access.request") || ctx.permissions.includes("identity.manage");

  return (
    <div className="space-y-5">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">My team</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">The people who report to you.</p>
      </div>
      <Card>
        <CardHeader title="Direct reports" description={`${reports.length}`} />
        <CardBody>
          {reports.length === 0 ? (
            <EmptyState title="No direct reports" description="People whose manager is you appear here." />
          ) : (
            <ul className="divide-y divide-border">
              {reports.map((r) => {
                const state = STATE[r.lifecycleState ?? ""] ?? { label: r.lifecycleState ?? "", tone: "neutral" as const };
                return (
                  <li key={r.id} className="space-y-2 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="min-w-0">
                        <span className="font-medium text-foreground">{r.displayName}</span>
                        <span className="block text-xs text-muted-foreground">{[r.title, r.email, r.endDate ? `Ends ${r.endDate.slice(0, 10)}` : null].filter(Boolean).join(" · ")}</span>
                      </span>
                      {state.label ? <Badge tone={state.tone}>{state.label}</Badge> : null}
                    </div>
                    {canDisable && (r.lifecycleState === "ACTIVE" || r.lifecycleState === "LEAVE_PENDING") ? <DisableAllAccess identityId={r.id} name={r.displayName} /> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
