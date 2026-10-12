import { PendingSubmitButton } from "@/modules/ui";
import { setConnectionWritesAction } from "@/app/actions/connectorFiles";
import type { ConnectionWrites } from "@/modules/integrations/service";

const OPERATION: Record<string, string> = { revoke_access: "remove access", disable_account: "disable accounts" };

/**
 * INTEGRATION-P0-13 (decision D3): whether this connection makes approved
 * changes in the system itself. Off by default; only what the connection
 * type supports. Turning it on or off needs integration.update.
 */
export function ConnectionWritesForm({ integrationId, writes, canEdit }: { integrationId: string; writes: ConnectionWrites; canEdit: boolean }) {
  const what = writes.supported.map((op) => OPERATION[op] ?? op).join(" and ");
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-foreground">
        {writes.enabled ? `On: approved requests to ${what} are carried out here, then verified by the next sync.` : `Off: approved changes are tasks for a person. This connection can ${what}.`}
      </p>
      {canEdit ? (
        <form action={setConnectionWritesAction.bind(null, integrationId)}>
          <input type="hidden" name="enabled" value={writes.enabled ? "false" : "true"} />
          <PendingSubmitButton variant={writes.enabled ? "outline" : "secondary"} pendingLabel="Saving…">
            {writes.enabled ? "Turn off" : "Turn on"}
          </PendingSubmitButton>
        </form>
      ) : null}
    </div>
  );
}
