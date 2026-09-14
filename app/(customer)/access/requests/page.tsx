import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listAccessRequests } from "@/modules/access-governance/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Card, CardHeader, CardBody } from "@/modules/ui";
import { AccessRequestsTable } from "./AccessRequestsTable";

export default async function AccessRequestsPage() {
  let ctx;
  try {
    ctx = await requirePermission("access.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const requests = await listAccessRequests(ctx.tenantId!);

  return (
    <div className="space-y-4">
      <Link href="/access" className="text-sm text-primary hover:underline">
        ← Applications
      </Link>
      <h1 className="text-xl font-semibold text-foreground">Access Requests</h1>

      <Card>
        <CardHeader title="Requests" description={`${requests.length} total`} />
        <CardBody>
          <AccessRequestsTable requests={requests} />
        </CardBody>
      </Card>
    </div>
  );
}
