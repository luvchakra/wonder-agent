import { AuthShell } from "@/modules/ui";

// FOUNDATION-P0-22 — what an address that names no organization shows (see page.tsx).
export default function TenantNotFound() {
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
