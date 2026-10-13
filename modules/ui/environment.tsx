import { cn } from "@/lib/utils";

/**
 * Owner request (2026-10-13): each environment has one designated colour,
 * the same for every organization, so nobody mistakes a test organization
 * for production. Theme tokens only (light and dark), with the name always
 * written next to the colour (never colour alone).
 */
export type EnvironmentKind = "production" | "development" | "test" | "staging" | "sandbox";

export const ENVIRONMENT_COLOR: Record<EnvironmentKind, { label: string; badge: string; dot: string; bar: string }> = {
  production: { label: "Production", badge: "border-success/30 bg-success/10 text-success", dot: "bg-success", bar: "bg-success" },
  development: { label: "Development", badge: "border-info/30 bg-info/10 text-info", dot: "bg-info", bar: "bg-info" },
  test: { label: "Test", badge: "border-warning/30 bg-warning/10 text-warning", dot: "bg-warning", bar: "bg-warning" },
  staging: { label: "Staging", badge: "border-violet/30 bg-violet/10 text-violet", dot: "bg-violet", bar: "bg-violet" },
  sandbox: { label: "Sandbox", badge: "border-border bg-muted text-muted-foreground", dot: "bg-muted-foreground", bar: "bg-muted-foreground" },
};

export function environmentColor(kind: string | null | undefined) {
  return ENVIRONMENT_COLOR[(kind ?? "production") as EnvironmentKind] ?? ENVIRONMENT_COLOR.production;
}

/** The environment's name on its colour. */
export function EnvironmentBadge({ environment, className }: { environment: string | null | undefined; className?: string }) {
  const c = environmentColor(environment);
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", c.badge, className)}>
      <span aria-hidden className={cn("size-1.5 rounded-full", c.dot)} />
      {c.label}
    </span>
  );
}
