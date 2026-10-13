import { getPlatformHealth, getWonderappsDashboardAccess } from "@/modules/platform-admin/service";
import { setWonderappsAccessAction } from "@/app/actions/platform";

// See app/platform-admin/page.tsx for why this is forced.
export const dynamic = "force-dynamic";

export default async function PlatformHealthPage() {
  const [health, wonderapps] = await Promise.all([getPlatformHealth(), getWonderappsDashboardAccess()]);

  return (
    <main>
      <h1>Platform Health</h1>
      <ul>
        {health.signals.map((s) => (
          <li key={s.name}>
            [{s.status}] {s.name}
            {s.detail ? ` — ${s.detail}` : ""}
          </li>
        ))}
      </ul>
      <p style={{ color: "#666" }}>Checked at {health.checkedAt}</p>

      {/* Owner decision (2026-10-13): WonderApps reads across organizations only while this is on. */}
      <h2>WonderApps dashboard access</h2>
      <p>
        {wonderapps === null
          ? "Unavailable: the current state could not be read."
          : wonderapps
            ? "On: the WonderApps dashboard can read WonderID data across all organizations (never the AI provider keys)."
            : "Off: the WonderApps dashboard cannot read any WonderID data."}
      </p>
      {wonderapps === null ? null : (
        <form action={setWonderappsAccessAction}>
          <input type="hidden" name="enabled" value={wonderapps ? "false" : "true"} />
          <button type="submit">{wonderapps ? "Turn off WonderApps access" : "Turn on WonderApps access"}</button>
        </form>
      )}
      <p style={{ color: "#666" }}>Every change is recorded in the platform audit log.</p>
    </main>
  );
}
