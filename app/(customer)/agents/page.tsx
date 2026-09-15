import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listAgents } from "@/modules/agent-identity/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { LinkButton } from "@/modules/ui";
import { AgentsTable } from "./AgentsTable";

// EXPERIENCE-P0-08 — first real consumer of the shared DataTable primitive.
// UX-P0-05/UX-P0-11 (12_ADVANCED_PRODUCT_UX_REQUIREMENTS.md §8) — the
// universal page framework: breadcrumb, title + primary action, one-line
// description + secondary actions, then main content. Was raw unstyled
// scaffolding (inline styles, a bare <main> nested inside the shell's own
// <main>) — this is that screen's standardization pass.
export default async function AgentsPage() {
  let ctx;
  try {
    ctx = await requirePermission("agent.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }

  const agents = await listAgents(ctx.tenantId!);

  return (
    <div className="space-y-4">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href="/" className="hover:text-foreground hover:underline">
          Overview
        </Link>
        <span aria-hidden> / </span>
        <span className="text-foreground">AI Identity</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">AI Agents</h1>
          <p className="mt-1 text-sm text-muted-foreground">Every AI agent registered or discovered in this tenant, governed as a first-class enterprise identity.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LinkButton href="/agents/discovery" variant="outline" size="sm">
            Discovery inbox
          </LinkButton>
          <LinkButton href="/agents/duplicates" variant="outline" size="sm">
            Duplicate review
          </LinkButton>
          <LinkButton href="/agents/new" size="sm">
            + Register agent
          </LinkButton>
        </div>
      </div>

      <AgentsTable agents={agents} />
    </div>
  );
}
