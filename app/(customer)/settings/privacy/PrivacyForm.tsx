"use client";

import { useActionState } from "react";
import type { PrivacyActionState } from "@/app/actions/privacy";
import { PendingSubmitButton } from "@/modules/ui";
import { cn } from "@/lib/utils";

/**
 * COMPLIANCE-P0-12 — one form shell for every privacy screen: it waits for
 * the server action's answer and shows it as given (§15, §17.5), with
 * field errors keyed by input name.
 */

const initial: PrivacyActionState = { ok: false, message: null };

export function PrivacyForm({
  action,
  children,
  submitLabel,
  pendingLabel,
  variant = "default",
  className,
}: {
  action: (prev: PrivacyActionState, formData: FormData) => Promise<PrivacyActionState>;
  children: React.ReactNode;
  submitLabel: string;
  pendingLabel: string;
  variant?: "default" | "outline" | "destructive";
  className?: string;
}) {
  const [state, formAction] = useActionState(action, initial);
  const errors = state.errors ?? {};
  return (
    <form action={formAction} className={cn("space-y-3", className)}>
      {children}
      {Object.keys(errors).length ? (
        <ul className="space-y-0.5 text-xs text-destructive">
          {Object.entries(errors).map(([k, v]) => (
            <li key={k}>{v}</li>
          ))}
        </ul>
      ) : null}
      {state.message ? (
        <p
          role={state.ok ? "status" : "alert"}
          className={cn("rounded-md border px-3 py-2 text-sm", state.ok ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive/10 text-destructive")}
        >
          {state.message}
        </p>
      ) : null}
      <PendingSubmitButton size="sm" variant={variant} pendingLabel={pendingLabel}>
        {submitLabel}
      </PendingSubmitButton>
    </form>
  );
}
