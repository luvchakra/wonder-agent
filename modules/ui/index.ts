/**
 * Shared design-system primitives owned by Experience Agent
 * (docs/plan/08-EXPERIENCE-AGENT-BACKLOG.md). Domain modules consume these
 * rather than hand-rolling their own per screen — see CLAUDE.md §13.
 */
export { Badge, SeverityBadge, StatusBadge, type BadgeTone } from "./Badge";
export { Card, CardHeader, CardBody, StatCard } from "./Card";
export { Button, LinkButton } from "./Button";
export { TableContainer, Thead, Th, Td, Tr } from "./Table";
export { EmptyState, ErrorState, NotYetAvailable, CardGridSkeleton, TableSkeleton, DetailSkeleton } from "./States";
export { ThemeToggle, ThemeFlashGuard } from "./theme";
export { Avatar } from "./Avatar";
export { WorkspaceSwitcher } from "./WorkspaceSwitcher";
export { RiskTrendChart } from "./RiskTrendChart";
export { ConfirmActionDialog, type ConfirmActionResult, type BulkActionItemResult } from "./ConfirmAction";
export { EvidenceDrawer, useEvidenceDrawerParam } from "./Drawer";
export { ShellGlobalSearch, ShellNotifications } from "./ShellSearchAndNotifications";
export { DataTable, useTableState, useClientFilteredRows, SimpleDataTable, type DataTableColumn, type TableState, type SortDir } from "./DataTable";
export { AgentTabs, type AgentTabKey } from "./AgentTabs";
export { Field, TextField, TextareaField, SelectField, fieldInputClass, fieldLabelClass } from "./Field";
export { AiSummaryPanel } from "./AiSummaryPanel";
export { AccessGraphView, layoutNodes, toFlowEdges } from "./AccessGraphView";
export { AnnouncementsBanner } from "./AnnouncementsBanner";
export { AuthShell } from "./AuthShell";
export { GoogleAuthButton } from "./GoogleAuthButton";
export { BrowserFrame, PhoneFrame } from "./ProductShot";
export { FlowDiagram } from "./FlowDiagram";
export { AppSidebar, MobileNavDrawer, MobileNavTrigger, openMobileNav, type SidebarUser } from "./AppSidebar";
export { MobileTabBar } from "./MobileTabBar";
export { SHELL_NAV, MOBILE_TABS, isNavItemActive, type ShellNavItem, type ShellBadgeCounts } from "./shell-nav";
export { NavIcon } from "./NavIcon";
export { AccountPanel, type TenantOption } from "./AccountPanel";
export { KpiCard, type KpiTone } from "./KpiCard";
export { Tabs, TabPanel } from "./Tabs";
export { CountPills, type CountPill } from "./CountPills";
export { DonutChart, TrendChart } from "./charts.lazy";
export type { Slice, TrendSeries } from "./charts";
export { CoverageBars } from "./CoverageBars";
