import { AuthShell } from "@/modules/ui";

// FOUNDATION-P0-22 — an address under the WonderID domain that names no
// organization (or a malformed one). The proxy rewrites every path there to
// this page with status 404, keeping the URL. It says nothing about which
// organizations exist.
export const metadata = { title: "Organization not found" };

export default function TenantNotFoundPage() {
  return (
    <AuthShell
      title="No organization at this address"
      subtitle="Check the address your administrator gave you. Each organization has its own WonderID address."
      footer={<>If you think this is a mistake, contact your WonderID administrator.</>}
    >
      <p className="text-sm text-muted-foreground">Nothing was signed in or changed.</p>
    </AuthShell>
  );
}
