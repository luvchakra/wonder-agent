"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { Button } from "./Button";

export type BulkActionItemResult = { id: string; label: string; success: boolean; error?: string };

export type ConfirmActionResult =
  | { kind: "single"; success: boolean; error?: string }
  | { kind: "bulk"; results: BulkActionItemResult[] };

/**
 * EXPERIENCE-P0-04 — Action Safety. A shared confirmation primitive for
 * destructive/high-impact actions (certify, restrict, suspend, remediate,
 * bulk operations). This is presentation only: `onConfirm` is supplied by
 * the calling domain module and is the only place an authorization/
 * approval decision is made (non-negotiable #15) — this component never
 * decides whether an action is allowed, only renders the confirm/in-flight/
 * result UX consistently everywhere it's used.
 */
export function ConfirmActionDialog({
  trigger,
  title,
  description,
  scopePreview,
  reasonRequired = false,
  reasonLabel = "Reason",
  confirmLabel = "Confirm",
  variant = "destructive",
  onConfirm,
  onDone,
}: {
  trigger: React.ReactNode;
  title: string;
  /** e.g. "This will revoke access for FinanceBot." */
  description: string;
  /** e.g. "3 access grants affected" — the scope-preview requirement. */
  scopePreview?: React.ReactNode;
  reasonRequired?: boolean;
  reasonLabel?: string;
  confirmLabel?: string;
  variant?: "destructive" | "primary";
  onConfirm: (reason: string) => Promise<ConfirmActionResult>;
  /** Called after the dialog closes following a completed action. */
  onDone?: (result: ConfirmActionResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ConfirmActionResult | null>(null);

  function reset() {
    setReason("");
    setBusy(false);
    setResult(null);
  }

  async function handleConfirm() {
    setBusy(true);
    try {
      const r = await onConfirm(reason);
      setResult(r);
    } finally {
      setBusy(false);
    }
  }

  function handleOpenChange(next: boolean) {
    if (busy) return; // never let Escape/overlay-click interrupt an in-flight action
    setOpen(next);
    if (!next) {
      if (result) onDone?.(result);
      reset();
    }
  }

  const canConfirm = !reasonRequired || reason.trim().length > 0;

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-surface p-4 shadow-md focus:outline-none"
          onEscapeKeyDown={(e) => {
            if (busy) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (busy) e.preventDefault();
          }}
        >
          <Dialog.Title className="text-sm font-semibold text-text-primary">{title}</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-text-secondary">{description}</Dialog.Description>

          {!result && (
            <>
              {scopePreview && (
                <div className="mt-3 rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm text-text-primary">{scopePreview}</div>
              )}

              {reasonRequired && (
                <div className="mt-3">
                  <label htmlFor="confirm-action-reason" className="mb-1 block text-xs font-medium text-text-secondary">
                    {reasonLabel} (required)
                  </label>
                  <textarea
                    id="confirm-action-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                    className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  />
                </div>
              )}

              <div className="mt-4 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button variant={variant} onClick={handleConfirm} disabled={busy || !canConfirm} aria-busy={busy}>
                  {busy ? "Working…" : confirmLabel}
                </Button>
              </div>
            </>
          )}

          {result && <ActionResultPanel result={result} onClose={() => handleOpenChange(false)} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ActionResultPanel({ result, onClose }: { result: ConfirmActionResult; onClose: () => void }) {
  if (result.kind === "single") {
    return (
      <div className="mt-3" role="status">
        <p className={`text-sm font-medium ${result.success ? "text-success" : "text-danger"}`}>
          {result.success ? "Done." : `Failed${result.error ? `: ${result.error}` : "."}`}
        </p>
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    );
  }

  const succeeded = result.results.filter((r) => r.success).length;
  const failed = result.results.length - succeeded;

  return (
    <div className="mt-3" role="status">
      <p className="text-sm font-medium text-text-primary">
        {succeeded} of {result.results.length} succeeded{failed > 0 ? `, ${failed} failed` : ""}
      </p>
      {failed > 0 && (
        <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs">
          {result.results
            .filter((r) => !r.success)
            .map((r) => (
              <li key={r.id} className="rounded-md border border-danger/30 bg-danger/5 px-2 py-1 text-danger">
                {r.label}: {r.error ?? "failed"}
              </li>
            ))}
        </ul>
      )}
      <div className="mt-4 flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
