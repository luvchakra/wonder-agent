import { Activity, Bot, ClipboardList, LayoutDashboard, Plug, Search, Settings, ShieldAlert, ShieldCheck, type LucideIcon } from "lucide-react";

/**
 * Resolves a nav group's icon name to its lucide-react component — same
 * "name string on the data, component lookup in the shell" pattern
 * WonderArk's own ModuleIcon uses (packages/core/src/components/shell/
 * module-icon.tsx), so nav data stays plain/serializable.
 */
const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  Bot,
  ShieldCheck,
  Activity,
  ShieldAlert,
  Plug,
  Search,
  ClipboardList,
  Settings,
};

export function NavIcon({ name, className }: { name?: string; className?: string }) {
  const Icon = (name && ICONS[name]) || LayoutDashboard;
  return <Icon className={className} aria-hidden="true" />;
}
