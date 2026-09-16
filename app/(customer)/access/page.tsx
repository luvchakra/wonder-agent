import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listApplications } from "@/modules/access-governance/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { createApplicationAction } from "@/app/actions/access";
import { ApplicationsTable } from "./ApplicationsTable";
import { Card, CardHeader, CardBody, Button, TextField } from "@/modules/ui";

export default async function AccessPage() {
  let ctx;
  try {
    ctx = await requirePermission("access.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const applications = await listApplications(ctx.tenantId!);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Applications</h1>
        <Link href="/access/requests" className="text-sm text-primary hover:underline">
          View access requests →
        </Link>
      </div>

      <Card>
        <CardHeader title="Applications" description={`${applications.length} registered`} />
        <CardBody>
          <ApplicationsTable applications={applications} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Add an application" />
        <CardBody>
          <form action={createApplicationAction} className="flex flex-wrap items-end gap-2">
            <TextField label="Application name" name="name" required />
            <TextField label="Category" name="category" placeholder="optional" />
            <label className="flex items-center gap-2 pb-2 text-sm text-foreground">
              <input type="checkbox" name="isExternal" />
              External-facing (email, messaging, public API)
            </label>
            <Button type="submit" variant="secondary">
              Add
            </Button>
          </form>
        </CardBody>
      </Card>

      <Link href="/agents" className="text-sm text-primary hover:underline">
        ← AI Agents
      </Link>
    </div>
  );
}
