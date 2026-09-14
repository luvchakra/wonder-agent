import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listIntegrationTypes } from "@/modules/integrations/service";
import { createIntegrationAction } from "@/app/actions/integrations";
import { ApiError } from "@/lib/shared/types/foundation";
import { Card, CardHeader, CardBody, Button, TextField, SelectField } from "@/modules/ui";

export default async function NewIntegrationPage() {
  try {
    await requirePermission("integration.create");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const types = await listIntegrationTypes();

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="text-xl font-semibold text-foreground">Add an integration</h1>
      <Card>
        <CardHeader title="Integration details" />
        <CardBody>
          <form action={createIntegrationAction} className="space-y-4">
            <SelectField label="Type" name="integrationTypeId">
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.displayName}
                </option>
              ))}
            </SelectField>
            <TextField label="Name" name="name" required />
            <TextField label="Base URL" name="baseUrl" placeholder="https://…" />
            <Button type="submit">Create</Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
