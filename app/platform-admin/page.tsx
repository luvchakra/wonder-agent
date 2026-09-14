import { listTenants, getPlatformHealth } from "@/modules/platform-admin/service";

// Not statically analyzable as dynamic (the requirePlatformAdmin() auth
// check lives in the enclosing layout, not this page) — force it, or a
// production build attempts to prerender this page at build time and
// fails outside of a request context.
export const dynamic = "force-dynamic";

// Bare functional screen — see docs/design/UI-UX-DESIGN-RULES.md; Platform
// Agent owns this console's UI directly (no Experience Agent restyle for
// platform-admin per CLAUDE.md §2/ownership map), but polish is not this
// story's acceptance criterion.
export default async function PlatformOverviewPage() {
  const [tenants, health] = await Promise.all([listTenants(), getPlatformHealth()]);

  return (
    <main>
      <h1>Platform Overview</h1>
      <p>{tenants.length} tenant(s) provisioned.</p>
      <h2>Health</h2>
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
