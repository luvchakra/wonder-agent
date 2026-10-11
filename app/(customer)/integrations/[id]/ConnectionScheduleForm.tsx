import { PendingSubmitButton, SelectField } from "@/modules/ui";
import { setConnectionScheduleAction } from "@/app/actions/connectorFiles";
import type { ConnectionSchedule } from "@/modules/integrations/service";

const LABEL: Record<ConnectionSchedule, string> = { manual: "Manual", daily: "Daily", hourly: "Hourly" };

/**
 * INTEGRATION-P0-20: how often a connection syncs, on every connection
 * that reads. Changing it needs integration.update; others see the value.
 */
export function ConnectionScheduleForm({ integrationId, schedule, canEdit }: { integrationId: string; schedule: ConnectionSchedule; canEdit: boolean }) {
  if (!canEdit) return <p className="mb-3 text-sm text-muted-foreground">Sync schedule: {LABEL[schedule]}</p>;
  return (
    <form action={setConnectionScheduleAction.bind(null, integrationId)} className="mb-3 flex flex-wrap items-end gap-2">
      <SelectField label="Sync schedule" name="schedule" defaultValue={schedule} hint="Scheduled syncs run once a day on the current plan.">
        <option value="manual">Manual</option>
        <option value="daily">Daily</option>
        <option value="hourly">Hourly</option>
      </SelectField>
      <PendingSubmitButton variant="secondary" pendingLabel="Saving…">
        Save
      </PendingSubmitButton>
    </form>
  );
}
