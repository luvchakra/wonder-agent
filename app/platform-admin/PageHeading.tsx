import type { PlatformHealth } from "@/lib/shared/types/platform";
import { StatusBadge } from "@/modules/ui";

/** One heading style for every platform console page. */
export function PageHeading({ title, description, children }: { title: string; description?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}

const HEALTH = {
  ok: { tone: "success", label: "OK" },
  degraded: { tone: "warning", label: "Degraded" },
  not_instrumented: { tone: "neutral", label: "Not measured" },
} as const;

/** The platform health signals as rows, shared by the overview and health pages. */
export function HealthSignals({ health }: { health: PlatformHealth }) {
  return (
    <>
      <ul className="divide-y divide-border">
        {health.signals.map((s) => (
          <li key={s.name} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{s.name}</p>
              {s.detail ? <p className="text-xs text-muted-foreground">{s.detail}</p> : null}
            </div>
            <StatusBadge tone={HEALTH[s.status].tone}>{HEALTH[s.status].label}</StatusBadge>
          </li>
        ))}
      </ul>
      <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">Checked {new Date(health.checkedAt).toLocaleString()}</p>
    </>
  );
}
