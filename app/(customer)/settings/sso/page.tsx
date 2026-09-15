import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listSsoConnections } from "@/lib/auth/sso";
import { ApiError } from "@/lib/shared/types/foundation";
import { createSsoConnectionAction, setSsoConnectionStatusAction } from "@/app/actions/sso";
import { Card, CardBody, CardHeader, TableContainer, Thead, Th, Tr, Td, EmptyState, StatusBadge } from "@/modules/ui";

// FOUNDATION-P0-03.3 — bare functional admin page, gated by `sso.manage`.
// Not styled to the full UI-UX-DESIGN-RULES standard yet — Experience Agent
// restyles domain module pages per CLAUDE.md §13's "bare functional pages"
// allowance; this page reuses modules/ui/* primitives in the meantime.
export default async function SsoSettingsPage() {
  let ctx;
  try {
    ctx = await requirePermission("sso.manage");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    if (err instanceof ApiError && err.status === 403) redirect("/settings");
    throw err;
  }

  const connections = await listSsoConnections(ctx.tenantId!);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-foreground">Single Sign-On</h1>
      <p className="text-sm text-muted-foreground">
        Configure a SAML or OIDC connection for your organization&apos;s email domain.
        Users signing in from a matching domain are offered SSO instead of a password.
        A new connection does not grant access by itself — the domain is only used to
        route the sign-in flow; tenant membership is still explicit (just-in-time on
        first successful SSO sign-in, using the role mapping below).
      </p>

      <Card>
        <CardHeader title="Connections" />
        <CardBody>
          {connections.length === 0 ? (
            <EmptyState title="No SSO connections configured" />
          ) : (
            <TableContainer>
              <Thead>
                <tr>
                  <Th>Domain</Th>
                  <Th>Protocol</Th>
                  <Th>Default role</Th>
                  <Th>Status</Th>
                  <Th>Actions</Th>
                </tr>
              </Thead>
              <tbody>
                {connections.map((c) => (
                  <Tr key={c.id}>
                    <Td>{c.domain}</Td>
                    <Td>{c.protocol.toUpperCase()}</Td>
                    <Td>{c.defaultRole}</Td>
                    <Td>
                      <StatusBadge tone={c.status === "active" ? "success" : "neutral"}>{c.status}</StatusBadge>
                    </Td>
                    <Td>
                      <form action={setSsoConnectionStatusAction}>
                        <input type="hidden" name="id" value={c.id} />
                        <input
                          type="hidden"
                          name="status"
                          value={c.status === "active" ? "disabled" : "active"}
                        />
                        <button type="submit" className="text-primary hover:underline">
                          {c.status === "active" ? "Disable" : "Enable"}
                        </button>
                      </form>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableContainer>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Add a connection" />
        <CardBody>
          <form action={createSsoConnectionAction} className="space-y-3 max-w-md">
            <label className="block text-sm text-muted-foreground">
              Email domain
              <input name="domain" required placeholder="example.com" className="mt-1 block w-full rounded border border-border bg-background px-2 py-1 text-foreground" />
            </label>
            <label className="block text-sm text-muted-foreground">
              Protocol
              <select name="protocol" required defaultValue="saml" className="mt-1 block w-full rounded border border-border bg-background px-2 py-1 text-foreground">
                <option value="saml">SAML 2.0</option>
                <option value="oidc">OIDC</option>
              </select>
            </label>
            <label className="block text-sm text-muted-foreground">
              Entity ID / Issuer
              <input name="entityIdOrIssuer" required className="mt-1 block w-full rounded border border-border bg-background px-2 py-1 text-foreground" />
            </label>
            <label className="block text-sm text-muted-foreground">
              SSO URL (SAML only)
              <input name="ssoUrl" className="mt-1 block w-full rounded border border-border bg-background px-2 py-1 text-foreground" />
            </label>
            <label className="block text-sm text-muted-foreground">
              Certificate (SAML only)
              <textarea name="certificate" rows={3} className="mt-1 block w-full rounded border border-border bg-background px-2 py-1 text-foreground" />
            </label>
            <label className="block text-sm text-muted-foreground">
              Default role for new SSO users
              <input name="defaultRole" defaultValue="READ_ONLY" required className="mt-1 block w-full rounded border border-border bg-background px-2 py-1 text-foreground" />
            </label>
            <button type="submit" className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground">
              Add connection
            </button>
          </form>
        </CardBody>
      </Card>

      <p className="text-xs text-muted-foreground">
        Note: this admin console configures WonderAgent&apos;s own record of the
        connection and JIT provisioning rules. The underlying IdP handshake also
        requires a matching SSO provider to be registered on the Supabase project
        itself (an Enterprise/Pro-tier, project-level setup step) — see
        docs/design/foundation-agent-backlog-audit.md for what has and hasn&apos;t
        been verified end-to-end in this environment.
      </p>
    </div>
  );
}
