import { getPlatformHealth } from "@/modules/platform-admin/service";

// See app/platform-admin/page.tsx for why this is forced.
export const dynamic = "force-dynamic";

export default async function PlatformHealthPage() {
  const health = await getPlatformHealth();

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
    </main>
  );
}
