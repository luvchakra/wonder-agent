"use client";

import Link from "next/link";
import { Badge, type BadgeTone, Button, SimpleDataTable, type DataTableColumn } from "@/modules/ui";
import { decideAccessRequestAction } from "@/app/actions/access";

type AccessRequestRow = { id: string; agentId: string; justification: string; status: string };

const STATUS_TONE: Record<string, BadgeTone> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  fulfilled: "neutral",
};

export function AccessRequestsTable({ requests }: { requests: AccessRequestRow[] }) {
  const columns: DataTableColumn<AccessRequestRow>[] = [
    { key: "agentId", header: "Agent", sortable: true, render: (r) => <Link href={`/agents/${r.agentId}`} className="text-primary hover:underline">{r.agentId}</Link> },
    { key: "justification", header: "Justification", render: (r) => r.justification },
    { key: "status", header: "Status", sortable: true, render: (r) => <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</Badge> },
    {
      key: "decide",
      header: "Decide",
      render: (r) => {
        const decideWithId = decideAccessRequestAction.bind(null, r.id);
        if (r.status === "pending") {
          return (
            <form action={decideWithId} className="flex gap-2">
              <Button type="submit" name="decision" value="approved" size="sm">
                Approve
              </Button>
              <Button type="submit" name="decision" value="rejected" variant="destructive" size="sm">
                Reject
              </Button>
            </form>
          );
        }
        if (r.status === "approved") {
          return (
            <form action={decideWithId}>
              <Button type="submit" name="decision" value="fulfilled" variant="secondary" size="sm">
                Mark fulfilled
              </Button>
            </form>
          );
        }
        return null;
      },
    },
  ];

  return (
    <SimpleDataTable
      columns={columns}
      rows={requests}
      getRowId={(r) => r.id}
      getSearchableText={(r) => `${r.agentId} ${r.justification} ${r.status}`}
      getSortValue={(r, key) => (r as unknown as Record<string, string>)[key] ?? ""}
      paramPrefix="requests"
      defaultSortKey="status"
      emptyTitle="No access requests yet"
      filterPlaceholder="Filter by agent, justification, or status…"
    />
  );
}
