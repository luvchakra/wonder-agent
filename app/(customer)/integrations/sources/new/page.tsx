import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listIntegrations } from "@/modules/integrations/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Card, CardBody, CardHeader } from "@/modules/ui";
import { SourceForm } from "../SourceForms";

export default async function NewIdentitySourcePage() {
  let ctx;
  try {
    ctx = await requirePermission("integration.create");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const integrations = (await listIntegrations(ctx.tenantId!)).map((i) => ({ id: i.id, name: i.name }));
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href="/integrations/sources" className="hover:text-foreground hover:underline">
          Identity sources
        </Link>
        <span aria-hidden> / </span>
        <span className="text-foreground">New source</span>
      </nav>
      <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">New identity source</h1>
      <Card>
        <CardHeader title="Source" description="Nothing is imported until you run it; you can review every setting first." />
        <CardBody>
          <SourceForm integrations={integrations} />
        </CardBody>
      </Card>
    </div>
  );
}
