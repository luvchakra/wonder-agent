import { listPlatformAdmins } from "@/modules/platform-admin/service";
import { grantPlatformAdminAction } from "@/app/actions/platform";
import { parsePlatformAdminEmails } from "@/lib/rbac/platformAdminEmails";
import { requirePlatformAdminOrBootstrap } from "@/lib/rbac/requirePlatformAdmin";
import { Badge, Button, Card, CardBody, CardHeader, fieldInputClass, fieldLabelClass } from "@/modules/ui";
import { PageHeading } from "../PageHeading";

// See app/platform-admin/page.tsx for why this is forced.
export const dynamic = "force-dynamic";

export default async function PlatformAdminsPage() {
  const [admins, me] = await Promise.all([listPlatformAdmins(), requirePlatformAdminOrBootstrap()]);
  // Addresses from the hosting environment (lib/rbac/platformAdminEmails.ts); they count only once confirmed.
  const fromEnv = [...parsePlatformAdminEmails(process.env.PLATFORM_ADMIN_EMAILS)].filter((e) => !admins.some((a) => a.email.toLowerCase() === e));

  return (
    <>
      <PageHeading title="Platform Admins" />
      <Card>
        <CardHeader title="Administrators" />
        <ul className="divide-y divide-border">
          {admins.map((a) => (
            <li key={a.userId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <span className="text-sm font-medium text-foreground">{a.email || a.userId}</span>
              <span className="text-xs text-muted-foreground">Granted {new Date(a.grantedAt).toLocaleDateString()}</span>
            </li>
          ))}
          {fromEnv.map((email) => (
            <li key={email} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <span className="text-sm font-medium text-foreground">{email}</span>
              <Badge>PLATFORM_ADMIN_EMAILS</Badge>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader
          title="Grant platform admin"
          description={
            me.bootstrap
              ? "You are signed in through PLATFORM_ADMIN_EMAILS, which can only add administrators here. Add yourself (your id is filled in) to open the rest of the console. Every grant is recorded in the platform audit log."
              : "The user's account id. Every grant is recorded in the platform audit log."
          }
        />
        <CardBody>
          <form action={grantPlatformAdminAction} className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1">
              <label htmlFor="target-user-id" className={fieldLabelClass}>
                User id
              </label>
              <input id="target-user-id" name="targetUserId" placeholder="00000000-0000-0000-0000-000000000000" defaultValue={me.bootstrap ? me.userId : undefined} required className={`${fieldInputClass} font-mono`} />
            </div>
            <Button type="submit">Grant</Button>
          </form>
        </CardBody>
      </Card>
    </>
  );
}
