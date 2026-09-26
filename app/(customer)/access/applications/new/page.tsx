import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listAccountableHumans } from "@/modules/agent-identity/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Card, CardBody, CardHeader } from "@/modules/ui";
import { ApplicationForm } from "../ApplicationForm";

// ACCESS-P0-15 — register an application by hand. It enters the catalog as
// DISCOVERED; onboarding (ACCESS-P0-16) takes it to ACTIVE.
export default async function RegisterApplicationPage() {
  let ctx;
  try {
    ctx = await requirePermission("access.manage");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const people = await listAccountableHumans(ctx.tenantId!);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href="/access" className="hover:text-foreground hover:underline">
          Applications
        </Link>
        <span aria-hidden> / </span>
        <span className="text-foreground">Register</span>
      </nav>
      <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Register an application</h1>
      <Card>
        <CardHeader title="Application" description="It enters the catalog as Discovered. Owners are people in this organization." />
        <CardBody>
          <ApplicationForm people={people} />
        </CardBody>
      </Card>
    </div>
  );
}
