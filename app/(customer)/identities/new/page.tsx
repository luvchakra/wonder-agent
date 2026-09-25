import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listAccountableHumans, listAttributeDefinitions } from "@/modules/agent-identity/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { MANUAL_IDENTITY_TYPES } from "@/lib/shared/types/agent-identity";
import { Card, CardBody, CardHeader } from "@/modules/ui";
import { NewIdentityForm } from "../IdentityForms";

// IDENTITY-P0-15 — create a person, external person or machine identity.
// AI agents are registered under AI Agents; their identity follows.

export default async function NewIdentityPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  let ctx;
  try {
    ctx = await requirePermission("identity.manage");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const { type } = await searchParams;
  const initialType = (MANUAL_IDENTITY_TYPES as readonly string[]).includes(type ?? "") ? type! : "HUMAN";
  const [people, definitions] = await Promise.all([listAccountableHumans(ctx.tenantId!), listAttributeDefinitions(ctx.tenantId!)]);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href="/identities" className="hover:text-foreground hover:underline">
          Identities
        </Link>
        <span aria-hidden> / </span>
        <span className="text-foreground">New identity</span>
      </nav>
      <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">New identity</h1>
      <Card>
        <CardHeader
          title="Identity details"
          description="To add an AI agent, register it under AI Agents; its identity appears here automatically."
        />
        <CardBody>
          <NewIdentityForm people={people} definitions={definitions} initialType={initialType} />
        </CardBody>
      </Card>
    </div>
  );
}
