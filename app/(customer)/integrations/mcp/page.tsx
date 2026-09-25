import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getMcpInventory } from "@/modules/integrations/service";
import { ApiError } from "@/lib/shared/types/foundation";
import type { McpServerInventory, McpToolOperation } from "@/lib/shared/types/integrations";
import { Badge, Card, CardBody, CardHeader, EmptyState, KpiCard, LinkButton, TableContainer, Td, Th, Thead, Tr, type BadgeTone } from "@/modules/ui";
import { DiscoverMcpButton } from "./DiscoverMcpButton";

// INTEGRATION-P0-06 (master P0-10) — the MCP inventory: each connected MCP
// server, the tools it declares (read, write or unknown, and why) and its
// resources. Declarations only: what an agent actually called is on the
// Runtime pages (DID), and what it may call is governed by its contract.

const OPERATION: Record<McpToolOperation, { label: string; tone: BadgeTone }> = {
  read: { label: "Read", tone: "success" },
  write: { label: "Write", tone: "warning" },
  unknown: { label: "Unknown", tone: "neutral" },
};

const fmt = (iso: string | null) => (iso ? iso.slice(0, 16).replace("T", " ") : "Never");

function ServerCard({ server, canDiscover }: { server: McpServerInventory; canDiscover: boolean }) {
  const current = server.tools.filter((t) => t.stillDeclared);
  const writes = current.filter((t) => t.operation === "write").length;
  return (
    <Card>
      <CardHeader
        title={server.integrationName}
        description={[server.serverName && `${server.serverName}${server.serverVersion ? ` ${server.serverVersion}` : ""}`, server.endpoint].filter(Boolean).join(" · ") || "Not discovered yet"}
        actions={canDiscover ? <DiscoverMcpButton integrationId={server.integrationId} name={server.integrationName} /> : null}
      />
      <CardBody className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Last discovered {fmt(server.lastDiscoveredAt)} · {current.length} tool{current.length === 1 ? "" : "s"} ({writes} write) ·{" "}
          {server.resources.filter((r) => r.stillDeclared).length} resource{server.resources.length === 1 ? "" : "s"}
          {server.protocolVersion ? ` · MCP ${server.protocolVersion}` : ""}
        </p>

        {server.tools.length === 0 ? (
          <EmptyState title="No tools discovered" description={server.lastDiscoveredAt ? "The server declared no tools." : "Run discovery to read what this server offers."} />
        ) : (
          <TableContainer label={`${server.integrationName} tools`} bare>
            <Thead>
              <tr>
                <Th>Tool</Th>
                <Th>Operation</Th>
                <Th hideBelow="lg">Decided by</Th>
                <Th hideBelow="xl">Description</Th>
                <Th>Status</Th>
              </tr>
            </Thead>
            <tbody>
              {server.tools.map((t) => (
                <Tr key={t.name}>
                  <Td>
                    <span className="font-mono text-xs text-foreground md:whitespace-nowrap">{t.name}</span>
                  </Td>
                  <Td>
                    <span className="flex flex-wrap gap-1">
                      <Badge tone={OPERATION[t.operation].tone} className="whitespace-nowrap">{OPERATION[t.operation].label}</Badge>
                      {t.destructive ? <Badge tone="danger" className="whitespace-nowrap">Destructive</Badge> : null}
                    </span>
                  </Td>
                  <Td hideBelow="lg">
                    <span className="text-muted-foreground">{t.operationBasis === "annotation" ? "Server annotation" : t.operationBasis === "name" ? "Tool name" : "—"}</span>
                  </Td>
                  <Td hideBelow="xl">
                    <span className="line-clamp-2 text-muted-foreground">{t.description ?? "—"}</span>
                  </Td>
                  <Td>{t.stillDeclared ? <Badge tone="info" className="whitespace-nowrap">Declared</Badge> : <Badge tone="neutral">No longer declared</Badge>}</Td>
                </Tr>
              ))}
            </tbody>
          </TableContainer>
        )}

        {server.resources.length > 0 ? (
          <div>
            <h3 className="text-sm font-medium text-foreground">Resources</h3>
            <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
              {server.resources.map((r) => (
                <li key={r.uri} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-xs text-foreground">{r.uri}</span>
                    {r.name ? <span className="block text-xs text-muted-foreground">{r.name}</span> : null}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {r.mimeType ?? ""}
                    {r.stillDeclared ? null : <Badge tone="neutral">No longer declared</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

export default async function McpInventoryPage() {
  let ctx;
  try {
    ctx = await requirePermission("integration.read");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }
  const servers = await getMcpInventory(ctx.tenantId!);
  const canDiscover = ctx.permissions.includes("integration.execute");
  const tools = servers.flatMap((s) => s.tools.filter((t) => t.stillDeclared));

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href="/integrations" className="hover:text-foreground hover:underline">
          Integrations
        </Link>
        <span aria-hidden> / </span>
        <span className="text-foreground">MCP servers</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">MCP servers</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            What each connected MCP server declares it offers. Discovery only reads declarations; it never calls a tool. What agents
            actually invoked is on the Runtime pages.
          </p>
        </div>
        <LinkButton href="/integrations/new" variant="outline" size="sm">
          + Connect an MCP server
        </LinkButton>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard size="sm" icon="Plug" tone="primary" label="MCP servers" value={servers.length} />
        <KpiCard size="sm" icon="KeyRound" tone="violet" label="Declared tools" value={tools.length} />
        <KpiCard size="sm" icon="TriangleAlert" tone="warning" label="Write tools" value={tools.filter((t) => t.operation === "write").length} />
        <KpiCard size="sm" icon="CircleAlert" tone="neutral" label="Unclassified tools" value={tools.filter((t) => t.operation === "unknown").length} />
      </div>

      {servers.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState title="No MCP servers connected" description="Connect an MCP server under Integrations, then discover what it offers." />
          </CardBody>
        </Card>
      ) : (
        servers.map((s) => <ServerCard key={s.integrationId} server={s} canDiscover={canDiscover} />)
      )}
    </div>
  );
}
