"use client";

import Link from "next/link";
import { Badge, DataTable, SeverityBadge, useTableState, type DataTableColumn } from "@/modules/ui";
import { DecisionForm } from "./DecisionForm";
import { EvidenceTrigger } from "./EvidenceDrawerClient";
import type { RiskSeverity } from "@/lib/shared/types/risk";

type CampaignItemRow = {
  id: string;
  agentId: string | null;
  identityId?: string | null;
  /** COMPLIANCE-P0-10: whose access and which, from the item's snapshot. */
  snapshot?: {
    person?: { displayName: string };
    accessGrant?: { application?: string; entitlementName?: string } | null;
    /** COMPLIANCE-P0-11: a WonderID role, directly or through a group. */
    role?: { displayName: string; privileged: boolean; group: { name: string } | null };
    /** COMPLIANCE-P0-10 part 3: one resource of an access package, for its owner's review. */
    package?: { ref: number | null; name: string; birthright: boolean; resource: { applicationName: string; entitlementName: string | null } };
    /** COMPLIANCE-P0-10 part 4: one entitlement of an application, for its owner's review. */
    catalogEntitlement?: { name: string; privilegeLevel: string | null; application: { id: string; ref: number | null; name: string } };
  } | null;
  riskAtReview: string | null;
  usageAtReview: string | null;
  recommendation: string | null;
  status: string;
  reviewerId: string | null;
};

/** §15: the page passes one page of items, paged, sorted and filtered in the database; this table keeps that state in the URL. */
export function CampaignItemsTable({ items, totalCount, currentUserId }: { items: CampaignItemRow[]; totalCount: number; currentUserId: string }) {
  const state = useTableState("items", { sortKey: "status", pageSize: 25 });
  const columns: DataTableColumn<CampaignItemRow>[] = [
    {
      key: "agentId",
      header: "Whose access",
      sortable: true,
      render: (i) =>
        i.snapshot?.catalogEntitlement ? (
          <span className="min-w-0">
            <Link href={`/access/applications/${i.snapshot.catalogEntitlement.application.ref ?? i.snapshot.catalogEntitlement.application.id}`} className="text-primary hover:underline">
              {i.snapshot.catalogEntitlement.application.name}
            </Link>
            <span className="block text-xs text-muted-foreground">
              {i.snapshot.catalogEntitlement.name}
              {i.snapshot.catalogEntitlement.privilegeLevel && i.snapshot.catalogEntitlement.privilegeLevel !== "standard" ? ` · ${i.snapshot.catalogEntitlement.privilegeLevel}` : ""}
            </span>
          </span>
        ) : i.snapshot?.package ? (
          <span className="min-w-0">
            <Link href={`/access/packages/${i.snapshot.package.ref ?? ""}`} className="text-primary hover:underline">
              {i.snapshot.package.name}
            </Link>
            <span className="block text-xs text-muted-foreground">
              {i.snapshot.package.resource.applicationName}
              {i.snapshot.package.resource.entitlementName ? ` · ${i.snapshot.package.resource.entitlementName}` : " · the application"}
              {i.snapshot.package.birthright ? " · birthright" : ""}
            </span>
          </span>
        ) : i.identityId ? (
          <span className="min-w-0">
            <Link href={`/identities/${i.identityId}`} className="text-primary hover:underline">
              {i.snapshot?.person?.displayName ?? "Identity"}
            </Link>
            <span className="block text-xs text-muted-foreground">
              {i.snapshot?.role
                ? `${i.snapshot.role.displayName}${i.snapshot.role.privileged ? " (privileged)" : ""} · ${i.snapshot.role.group ? `group ${i.snapshot.role.group.name}` : "direct"}`
                : `${i.snapshot?.accessGrant?.application ?? "?"} · ${i.snapshot?.accessGrant?.entitlementName ?? "?"}`}
            </span>
          </span>
        ) : (
          <Link href={`/agents/${i.agentId}`} className="text-primary hover:underline">
            {i.agentId}
          </Link>
        ),
    },
    { key: "riskAtReview", header: "Risk", sortable: true, render: (i) => (i.riskAtReview ? <SeverityBadge severity={i.riskAtReview as RiskSeverity} /> : "—") },
    { key: "usageAtReview", header: "Usage", render: (i) => i.usageAtReview ?? "—" },
    {
      key: "recommendation",
      header: "Recommendation",
      sortable: true,
      render: (i) =>
        i.recommendation ? (
          <Badge tone={i.recommendation === "remove" ? "danger" : i.recommendation === "review" ? "warning" : "success"}>{i.recommendation}</Badge>
        ) : (
          "—"
        ),
    },
    { key: "status", header: "Status", sortable: true, render: (i) => <Badge tone={i.status === "pending" ? "warning" : "success"}>{i.status}</Badge> },
    { key: "evidence", header: "Evidence", render: (i) => <EvidenceTrigger itemId={i.id} /> },
    {
      key: "decision",
      header: "Decision",
      render: (i) => {
        if (i.status !== "pending") return null;
        if (i.reviewerId !== currentUserId) return <span className="text-xs text-muted-foreground">Assigned reviewer only</span>;
        return <DecisionForm itemId={i.id} subject={i.agentId ? "agent" : i.snapshot?.catalogEntitlement ? "entitlement" : i.snapshot?.package ? "package" : i.snapshot?.role ? "role" : "person"} />;
      },
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={items}
      getRowId={(i) => i.id}
      totalCount={totalCount}
      state={state}
      emptyTitle="No items match"
      emptyDescription="Filter by pending, decided, keep, review, remove, or an agent id."
      filterPlaceholder="pending, decided, keep, review, remove, or an agent id"
    />
  );
}
