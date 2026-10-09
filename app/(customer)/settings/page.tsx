import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/modules/ui";
import { getMyMemberships, getTenantContext } from "@/lib/tenant/getTenantContext";
import { OrganizationNameForm } from "./OrganizationNameForm";

// Owned by Foundation Agent. Roles/Tenant Settings/Audit Logs UI remain
// deferred (see docs/design/foundation-agent-backlog-audit.md); SSO is
// live at /settings/sso (FOUNDATION-P0-03.3) and AI Provider configuration
// (Platform-owned, PLATFORM-P0-05.2) is live at /settings/ai.
export default async function SettingsPage() {
  // The layout has already resolved both (request-cached), so this costs nothing.
  const [ctx, memberships] = await Promise.all([getTenantContext(), getMyMemberships()]);
  const organizationName = memberships.find((m) => m.tenantId === ctx.tenantId)?.name ?? null;
  const canRename = ctx.permissions.includes("tenant.settings");

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-foreground">Administration</h1>
      {organizationName ? (
        <Card>
          <CardHeader
            title="Organization"
            description={canRename ? "The name everyone in your organization sees. New organizations are named from the account that created them; change it here." : "The name everyone in your organization sees."}
          />
          <CardBody>{canRename ? <OrganizationNameForm name={organizationName} /> : <p className="text-sm font-medium text-foreground">{organizationName}</p>}</CardBody>
        </Card>
      ) : null}
      <Card>
        <CardBody className="space-y-2">
          <Link href="/settings/users" className="block text-primary hover:underline">
            Users
          </Link>
          <Link href="/settings/roles" className="block text-primary hover:underline">
            Users &amp; Roles
          </Link>
          <Link href="/settings/sso" className="block text-primary hover:underline">
            Single Sign-On
          </Link>
          <Link href="/settings/security" className="block text-primary hover:underline">
            Security (Multi-Factor Authentication)
          </Link>
          <Link href="/settings/notifications" className="block text-primary hover:underline">
            Notification Preferences
          </Link>
          <Link href="/settings/ai" className="block text-primary hover:underline">
            AI Provider
          </Link>
          <Link href="/settings/billing" className="block text-primary hover:underline">
            Billing (plan, payments and invoices)
          </Link>
          <Link href="/settings/privacy" className="block text-primary hover:underline">
            Privacy &amp; Data Protection (GDPR / DPDP)
          </Link>
          <Link href="/audit/integrity" className="block text-primary hover:underline">
            Audit Integrity (tamper evidence)
          </Link>
          <Link href="/my-privacy" className="block text-primary hover:underline">
            My privacy
          </Link>
        </CardBody>
      </Card>
    </div>
  );
}
