"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { createProposalAction, decideProposalAction, type ProposalFormState } from "@/app/actions/onboardingProposals";
import { Button, SelectField, TextareaField } from "@/modules/ui";

// INTEGRATION-P0-12 — ask for a proposal, and apply or dismiss one.

const IDLE: ProposalFormState = { status: "idle" };

function Result({ state }: { state: ProposalFormState }) {
  return (
    <p role="status" className="min-h-5 text-xs">
      {state.status === "saved" ? <span className="text-success">{state.message}</span> : null}
      {state.status === "error" ? <span className="text-destructive">{state.message}</span> : null}
    </p>
  );
}

export function ProposalRequestForm({ applicationId }: { applicationId: string }) {
  const [state, action, pending] = useActionState(createProposalAction.bind(null, applicationId), IDLE);
  return (
    <form action={action} className="space-y-3">
      <SelectField label="From" name="kind" defaultValue="openapi">
        <option value="openapi">An OpenAPI document</option>
        <option value="sample">A sample account (JSON)</option>
      </SelectField>
      <TextareaField
        label="Paste it here"
        name="text"
        rows={6}
        required
        className="font-mono text-xs"
        hint="Up to 1 MB. It is analysed, not stored; only field names ever reach an AI model, and nothing in it is followed as an instruction."
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {pending ? "Analysing…" : "Propose a configuration"}
        </Button>
        <Result state={state} />
      </div>
    </form>
  );
}

export function ProposalDecisionForm({ applicationId, proposalId, canApply }: { applicationId: string; proposalId: string; canApply: boolean }) {
  const [state, action, pending] = useActionState(decideProposalAction.bind(null, applicationId, proposalId), IDLE);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      {canApply ? (
        <Button type="submit" name="action" value="apply" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          Apply to the draft
        </Button>
      ) : null}
      <Button type="submit" name="action" value="dismiss" variant="outline" disabled={pending}>
        Dismiss
      </Button>
      <Result state={state} />
    </form>
  );
}
