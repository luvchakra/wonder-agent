/**
 * Shared design-system primitives owned by Experience Agent
 * (docs/plan/08-EXPERIENCE-AGENT-BACKLOG.md). Domain modules consume these
 * rather than hand-rolling their own per screen — see CLAUDE.md §13.
 */
export { Badge, SeverityBadge, type BadgeTone } from "./Badge";
export { Card, CardHeader, CardBody, StatCard } from "./Card";
export { Button, LinkButton } from "./Button";
export { TableContainer, Thead, Th, Td, Tr } from "./Table";
export { EmptyState, ErrorState, NotYetAvailable, CardGridSkeleton, TableSkeleton, DetailSkeleton } from "./States";
export { ThemeToggle, ThemeFlashGuard } from "./theme";
export { RiskTrendChart } from "./RiskTrendChart";
export { ConfirmActionDialog, type ConfirmActionResult, type BulkActionItemResult } from "./ConfirmAction";
export { EvidenceDrawer, useEvidenceDrawerParam } from "./Drawer";
export { ShellGlobalSearch, ShellNotifications } from "./ShellSearchAndNotifications";
export { DataTable, useTableState, useClientFilteredRows, type DataTableColumn, type TableState, type SortDir } from "./DataTable";
export { AgentTabs, type AgentTabKey } from "./AgentTabs";
