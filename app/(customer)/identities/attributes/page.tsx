import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listAttributeDefinitions } from "@/modules/agent-identity/service";
import { ApiError } from "@/lib/shared/types/foundation";
import { Badge, Card, CardBody, CardHeader, EmptyState, TableContainer, Td, Th, Thead, Tr } from "@/modules/ui";
import { AttributeActiveButton, AttributeDefinitionForm } from "../IdentityForms";
import { IDENTITY_TYPE_LABEL } from "../labels";

// IDENTITY-P0-16 — the organization's own identity attributes: typed,
// optionally required, unique or sensitive, and enforced on every write.
// Retiring an attribute keeps the values already stored.

const DATA_TYPE_LABEL = { string: "Text", number: "Number", boolean: "Yes / no", date: "Date", enum: "Choice list" } as const;

export default async function IdentityAttributesPage() {
  let ctx;
  try {
    ctx = await requirePermission("identity.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const canManage = ctx.permissions.includes("identity.manage");
  const definitions = await listAttributeDefinitions(ctx.tenantId!);

  return (
    <div className="space-y-5">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">Identity attributes</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Fields your organization adds to identities, such as cost center or region. Values are checked against the type and rules
          here whenever an identity is saved.
        </p>
      </div>

      <Card>
        <CardHeader title="Attributes" description={`${definitions.filter((d) => d.active).length} active`} />
        <CardBody>
          {definitions.length === 0 ? (
            <EmptyState title="No attributes defined" description={canManage ? "Add the first one below." : "An identity administrator can add them."} />
          ) : (
            <TableContainer label="Identity attributes" bare>
              <Thead>
                <tr>
                  <Th>Attribute</Th>
                  <Th>Type</Th>
                  <Th hideBelow="lg">Applies to</Th>
                  <Th hideBelow="xl">Rules</Th>
                  <Th>Status</Th>
                  {canManage ? <Th className="text-right">Action</Th> : null}
                </tr>
              </Thead>
              <tbody>
                {definitions.map((d) => (
                  <Tr key={d.id}>
                    <Td>
                      <span className="font-medium text-foreground">{d.displayName}</span>
                      <span className="block font-mono text-xs text-muted-foreground">{d.name}</span>
                    </Td>
                    <Td>
                      {DATA_TYPE_LABEL[d.dataType]}
                      {d.dataType === "enum" ? <span className="block text-xs text-muted-foreground">{d.allowedValues.join(", ")}</span> : null}
                    </Td>
                    <Td hideBelow="lg">{d.identityType ? IDENTITY_TYPE_LABEL[d.identityType] : "Every type"}</Td>
                    <Td hideBelow="xl">
                      <span className="flex flex-wrap gap-1">
                        {d.required ? <Badge tone="info">Required</Badge> : null}
                        {d.uniqueValue ? <Badge tone="info">Unique</Badge> : null}
                        {d.sensitive ? <Badge tone="warning">Sensitive</Badge> : null}
                        {d.searchable ? <Badge tone="neutral">Searchable</Badge> : null}
                        {d.validationRegex ? <code className="text-xs text-muted-foreground">{d.validationRegex}</code> : null}
                      </span>
                    </Td>
                    <Td>
                      <Badge tone={d.active ? "success" : "neutral"}>{d.active ? "Active" : "Retired"}</Badge>
                    </Td>
                    {canManage ? (
                      <Td className="text-right">
                        <AttributeActiveButton definitionId={d.id} active={d.active} label={d.displayName} />
                      </Td>
                    ) : null}
                  </Tr>
                ))}
              </tbody>
            </TableContainer>
          )}
        </CardBody>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader title="Add an attribute" />
          <CardBody>
            <AttributeDefinitionForm />
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
