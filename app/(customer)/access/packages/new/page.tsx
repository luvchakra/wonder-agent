import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { listAccountableHumans } from "@/modules/agent-identity/service";
import { Card, CardBody, CardHeader } from "@/modules/ui";
import { PackageForm } from "../PackageForms";

// ACCESS-P0-20 — create an access package (a draft until it includes
// something, has an owner and is activated).

export default async function NewPackagePage() {
  let ctx;
  try {
    ctx = await requirePermission("access.manage");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const people = await listAccountableHumans(ctx.tenantId!);
  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href="/access/packages?view=manage" className="hover:text-foreground hover:underline">
          Access packages
        </Link>
        <span aria-hidden> / </span>
        <span className="text-foreground">New</span>
      </nav>
      <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">New access package</h1>
      <Card>
        <CardHeader title="Package and policy" description="Who it is for, who approves it, for how long, and how often it is certified." />
        <CardBody>
          <PackageForm
            packageId={null}
            people={people.map((p) => ({ id: p.id, label: `${p.displayName}${p.email ? ` (${p.email})` : ""}` }))}
            defaults={{
              name: "",
              description: null,
              ownerIdentityId: null,
              eligibleIdentityTypes: ["HUMAN"],
              eligibleDepartments: [],
              approval: "manager_and_owner",
              approvalMode: "sequential",
              approvalTimeoutDays: 5,
              onTimeout: "escalate",
              maxDurationDays: 365,
              defaultDurationDays: 90,
              certificationFrequency: "annual",
              requestable: true,
              extensionAllowed: false,
            }}
          />
        </CardBody>
      </Card>
    </div>
  );
}
