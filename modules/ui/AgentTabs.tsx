import Link from "next/link";

export type AgentTabKey = "overview" | "access" | "runtime" | "risk";

const TABS: { key: AgentTabKey; label: string; href: (agentId: string) => string }[] = [
  { key: "overview", label: "Overview", href: (id) => `/agents/${id}` },
  { key: "access", label: "Access (CAN)", href: (id) => `/access/agents/${id}` },
  { key: "runtime", label: "Runtime (DID)", href: (id) => `/runtime/agents/${id}` },
  { key: "risk", label: "Risk & Findings", href: (id) => `/risk/agents/${id}` },
];

/**
 * Per-agent sub-navigation shared across the four agent-detail routes
 * (Identity/Access/Runtime/Risk each own their own page — see
 * docs/design/ownership-map.md — this is Experience Agent's composition
 * layer stitching them into one coherent Agent Detail experience per
 * EXPERIENCE-P0-03). Real page navigation between separately-owned,
 * separately-permissioned routes, so this is a styled nav, not an ARIA
 * tablist — using tab semantics for full page navigation would misuse the
 * role for screen-reader users.
 */
export function AgentTabs({ agentId, active }: { agentId: string; active: AgentTabKey }) {
  return (
    <nav
      aria-label="Agent sections"
      className="flex gap-1 overflow-x-auto shadow-[inset_0_-1px_0_var(--color-border)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href(agentId)}
            aria-current={isActive ? "page" : undefined}
            className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              isActive
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
