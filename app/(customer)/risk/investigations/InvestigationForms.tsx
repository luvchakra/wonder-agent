"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import {
  addInvestigationNoteAction,
  assignInvestigationAction,
  changeInvestigationStatusAction,
  createInvestigationAction,
  type InvestigationFormState,
} from "@/app/actions/risk";
import { Button, SelectField, SeverityBadge, TextField } from "@/modules/ui";
import type { InvestigationStatus, RiskSeverity } from "@/lib/shared/types/risk";

const IDLE: InvestigationFormState = { status: "idle" };

function Result({ state }: { state: InvestigationFormState }) {
  return (
    <p role="status" className="min-h-5 text-xs">
      {state.status === "saved" ? <span className="text-success">{state.message}</span> : null}
      {state.status === "error" ? <span className="text-destructive">{state.message}</span> : null}
    </p>
  );
}

function Submit({ pending, idle, busy, variant = "secondary" }: { pending: boolean; idle: string; busy: string; variant?: "default" | "secondary" | "outline" }) {
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
      {pending ? busy : idle}
    </Button>
  );
}

export type OpenFindingOption = { id: string; title: string; agentName: string; severity: RiskSeverity };

export function CreateInvestigationForm({ findings }: { findings: OpenFindingOption[] }) {
  const [state, action, pending] = useActionState(createInvestigationAction, IDLE);
  return (
    <form action={action} className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="md:col-span-2">
          <TextField label="Title" name="title" required maxLength={200} placeholder="e.g. FinanceBot reached CustomerDB" />
        </div>
        <SelectField label="Priority" name="priority" defaultValue="">
          <option value="">From the worst finding</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </SelectField>
      </div>
      <TextField label="Summary (optional)" name="summary" maxLength={4000} />
      <fieldset>
        <legend className="text-sm font-medium text-foreground">Findings to investigate</legend>
        <p className="text-xs text-muted-foreground">Choose at least one open finding.</p>
        <ul className="mt-2 max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {findings.map((f) => (
            <li key={f.id}>
              <label className="flex cursor-pointer items-start gap-3 px-3 py-2 text-sm hover:bg-accent/40">
                <input type="checkbox" name="findingIds" value={f.id} className="mt-1 size-4 shrink-0 accent-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block text-foreground">{f.title}</span>
                  <span className="block text-xs text-muted-foreground">{f.agentName}</span>
                </span>
                <SeverityBadge severity={f.severity} />
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Submit pending={pending} idle="Open investigation" busy="Opening…" variant="default" />
        <Result state={state} />
      </div>
    </form>
  );
}

const STATUS_LABEL: Record<InvestigationStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  awaiting_remediation: "Awaiting remediation",
  resolved: "Resolved",
  closed: "Closed without resolution",
};

export function StatusForm({ id, allowed }: { id: string; allowed: InvestigationStatus[] }) {
  const [state, action, pending] = useActionState(changeInvestigationStatusAction.bind(null, id), IDLE);
  if (allowed.length === 0) return null;
  return (
    <form action={action} className="space-y-3">
      <SelectField label="Move to" name="status" defaultValue={allowed[0]}>
        {allowed.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </SelectField>
      <TextField label="Reason or resolution" name="reason" maxLength={4000} hint="Required to resolve or close." />
      <div className="flex flex-wrap items-center gap-3">
        <Submit pending={pending} idle="Update status" busy="Updating…" />
        <Result state={state} />
      </div>
    </form>
  );
}

export function AssignForm({ id, members, current }: { id: string; members: Array<{ id: string; name: string }>; current: string | null }) {
  const [state, action, pending] = useActionState(assignInvestigationAction.bind(null, id), IDLE);
  return (
    <form action={action} className="space-y-3">
      <SelectField label="Assignee" name="assigneeId" defaultValue={current ?? ""}>
        <option value="">Unassigned</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </SelectField>
      <div className="flex flex-wrap items-center gap-3">
        <Submit pending={pending} idle="Assign" busy="Assigning…" />
        <Result state={state} />
      </div>
    </form>
  );
}

export function NoteForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(addInvestigationNoteAction.bind(null, id), IDLE);
  return (
    <form action={action} className="space-y-3">
      <TextField label="Add a note" name="note" required maxLength={4000} />
      <div className="flex flex-wrap items-center gap-3">
        <Submit pending={pending} idle="Add note" busy="Adding…" />
        <Result state={state} />
      </div>
    </form>
  );
}
