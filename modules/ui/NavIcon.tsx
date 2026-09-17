import {
  Activity,
  Bot,
  CircleAlert,
  Clock,
  ClipboardCheck,
  ClipboardList,
  FileBarChart,
  Home,
  KeyRound,
  LayoutDashboard,
  Plug,
  Radar,
  Scale,
  ScrollText,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Siren,
  UserX,
  type LucideIcon,
} from "lucide-react";

/**
 * Resolves a nav item's icon name to its lucide-react component — the
 * "name string on the data, component lookup in the shell" pattern that
 * keeps modules/ui/shell-nav.ts plain and serializable, so the server
 * layout can pass it straight into client components.
 */
const ICONS: Record<string, LucideIcon> = {
  Activity,
  Bot,
  CircleAlert,
  Clock,
  ClipboardCheck,
  ClipboardList,
  FileBarChart,
  Home,
  KeyRound,
  LayoutDashboard,
  Plug,
  Radar,
  Scale,
  ScrollText,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Siren,
  UserX,
};

export function NavIcon({ name, className }: { name?: string; className?: string }) {
  const Icon = (name && ICONS[name]) || LayoutDashboard;
  return <Icon className={className} aria-hidden="true" />;
}
