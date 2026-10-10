import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { listConnectorDefinitions } from "@/modules/integrations/framework/catalog";
import { CONNECTOR_CATEGORIES } from "@/modules/integrations/framework/types";
import { CATEGORY_LABEL, RECEIVE_LABEL, RESOURCE_LABEL, connectionTypeHref } from "@/modules/integrations/framework/typeSummary";
import { Badge, Card, CardBody, CardHeader, TableContainer, Td, Th, Thead, Tr } from "@/modules/ui";

/**
 * Connection types: every kind of system WonderID can connect to, with its
 * protocol. A connection (/integrations) is created from one of these.
 */
export default async function ConnectionTypesPage() {
  let ctx;
  try {
    ctx = await requirePermission("integration.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const types = await listConnectorDefinitions(ctx.tenantId!);

  return (
    <div className="space-y-4">
      <Link href="/integrations" className="text-sm text-primary hover:underline">
        ← Connections
      </Link>
      <div>
        <h1 className="text-xl font-semibold text-foreground">Connection types</h1>
        <p className="mt-1 text-sm text-muted-foreground">Choose a type to see its protocol and create a connection with it.</p>
      </div>
      {CONNECTOR_CATEGORIES.map((category) => {
        const items = types.filter((t) => t.category === category);
        if (items.length === 0) return null;
        return (
          <Card key={category}>
            <CardHeader title={CATEGORY_LABEL[category]} />
            <CardBody className="p-0">
              <TableContainer label={`${CATEGORY_LABEL[category]} connection types`} bare>
                <Thead>
                  <tr>
                    <Th>Type</Th>
                    <Th>Protocol</Th>
                    <Th>Reads</Th>
                    <Th>Receives</Th>
                    <Th>Version</Th>
                  </tr>
                </Thead>
                <tbody>
                  {items.map((t) => (
                    <Tr key={`${t.origin}:${t.key}`}>
                      <Td>
                        <span className="inline-flex flex-wrap items-center gap-2">
                          <Link href={connectionTypeHref(t.origin, t.key)} className="font-medium text-primary hover:underline">
                            {t.name}
                          </Link>
                          {t.origin === "custom" ? <Badge tone="info">Your organization</Badge> : null}
                        </span>
                      </Td>
                      <Td className="whitespace-nowrap">{t.protocol}</Td>
                      <Td>{t.resources.length ? t.resources.map((r) => RESOURCE_LABEL[r]).join(", ") : <span className="text-muted-foreground">Nothing</span>}</Td>
                      <Td>{t.receives.length ? t.receives.map((r) => RECEIVE_LABEL[r] ?? r).join(", ") : <span className="text-muted-foreground">Nothing</span>}</Td>
                      <Td className="whitespace-nowrap tabular-nums">v{t.version}</Td>
                    </Tr>
                  ))}
                </tbody>
              </TableContainer>
            </CardBody>
          </Card>
        );
      })}
      <p className="text-sm text-muted-foreground">
        System not listed?{" "}
        <Link href="/integrations/types/new" className="text-primary hover:underline">
          Write a connection type
        </Link>{" "}
        for it.
      </p>
    </div>
  );
}
