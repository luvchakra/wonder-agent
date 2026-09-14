import { listPlatformAdmins } from "@/modules/platform-admin/service";
import { grantPlatformAdminAction } from "@/app/actions/platform";

// See app/platform-admin/page.tsx for why this is forced.
export const dynamic = "force-dynamic";

export default async function PlatformAdminsPage() {
  const admins = await listPlatformAdmins();

  return (
    <main>
      <h1>Platform Admins</h1>
      <ul>
        {admins.map((a) => (
          <li key={a.userId}>
            {a.email} — granted {a.grantedAt}
          </li>
        ))}
      </ul>

      <h2>Grant platform admin</h2>
      <form action={grantPlatformAdminAction}>
        <input name="targetUserId" placeholder="target user id (uuid)" required />
        <button type="submit">Grant</button>
      </form>
    </main>
  );
}
