import Link from "next/link";
import { Card, CardBody } from "@/modules/ui";

// Owned by Foundation Agent. Roles/Tenant Settings/Audit Logs UI remain
// deferred (see docs/design/foundation-agent-backlog-audit.md); SSO is
// live at /settings/sso (FOUNDATION-P0-03.3) and AI Provider configuration
// (Platform-owned, PLATFORM-P0-05.2) is live at /settings/ai.
export default function SettingsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-foreground">Administration</h1>
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
          <p className="text-sm text-muted-foreground">Tenant Settings administration screens are not yet available.</p>
        </CardBody>
      </Card>
    </div>
  );
}
