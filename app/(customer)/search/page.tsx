import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/tenant/getTenantContext";
import { search } from "@/modules/operations/service";

// OPERATIONS-P0-03.1/03.2. Bare functional screen — Experience Agent
// (Module 08) owns visual design; its own shell's global-search entry
// point (ShellGlobalSearch) currently shows a "Not yet available"
// placeholder pending this module — this standalone page is this
// module's own real, directly reachable interim surface while that
// wiring is still Experience Agent's to do.
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const ctx = await getTenantContext();
  if (!ctx.tenantId) redirect("/sign-in");

  const results = q ? await search(ctx.tenantId!, ctx.permissions, q) : [];

  return (
    <main style={{ maxWidth: 800, margin: "2rem auto", fontFamily: "sans-serif" }}>
      <h1>Search</h1>
      <form method="get">
        <input name="q" placeholder="Search agents, findings, policies…" defaultValue={q ?? ""} autoFocus />
        <button type="submit">Search</button>
      </form>

      {q && (
        <>
          <p>{results.length} results</p>
          <ul>
            {results.map((r) => (
              <li key={`${r.objectType}:${r.id}`} style={{ margin: "0.5rem 0" }}>
                <strong>[{r.objectType}]</strong> <a href={r.href}>{r.title}</a>
                {r.subtitle ? ` — ${r.subtitle}` : ""}
                {r.riskMasked ? " (risk: hidden)" : r.riskSeverity ? ` (risk: ${r.riskSeverity})` : ""}
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
