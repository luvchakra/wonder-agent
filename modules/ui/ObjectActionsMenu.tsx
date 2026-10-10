"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronDown, Download, Loader2, Upload } from "lucide-react";
import { Button } from "./Button";
import { checkImportFile, describeIssue, importResponseState, type ImportUiState } from "./importCsv";

export type ObjectExportItem = { label: string; href: string };
export type ObjectImportItem = { kind: string; label: string; title: string; required: string[]; optional: string[]; templateHref: string };

const itemClass = "flex cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-sm outline-none hover:bg-accent focus-visible:bg-accent data-[highlighted]:bg-accent";

/**
 * The object page's one "Actions" menu (2026-10-10): CSV export and, where
 * the object can be imported and the viewer may import, "Import CSV…". It
 * sits in the page header beside the page's primary action. Items come from
 * the server (Operations' `objectActionsFor()`), which only decides what to
 * show; the export route and the import endpoint check permissions again.
 * Renders nothing when the viewer has no item.
 */
export function ObjectActionsMenu({ exports = [], imports = [] }: { exports?: ObjectExportItem[]; imports?: ObjectImportItem[] }) {
  const [importing, setImporting] = useState<ObjectImportItem | null>(null);
  if (exports.length === 0 && imports.length === 0) return null;

  return (
    <>
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <Button variant="outline" size="sm">
            Actions
            <ChevronDown className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={6} className="z-50 min-w-48 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg">
            {exports.map((e) => (
              <DropdownMenu.Item key={e.href} asChild className={itemClass}>
                <a href={e.href} download>
                  <Download className="size-4 text-muted-foreground" aria-hidden="true" />
                  {e.label}
                </a>
              </DropdownMenu.Item>
            ))}
            {exports.length > 0 && imports.length > 0 ? <DropdownMenu.Separator className="my-1 h-px bg-border" /> : null}
            {imports.map((i) => (
              <DropdownMenu.Item key={i.kind} className={itemClass} onSelect={() => setImporting(i)}>
                <Upload className="size-4 text-muted-foreground" aria-hidden="true" />
                {i.label}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {importing ? <ImportCsvDialog item={importing} onClose={() => setImporting(null)} /> : null}
    </>
  );
}

function ImportCsvDialog({ item, onClose }: { item: ObjectImportItem; onClose: () => void }) {
  const inputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<ImportUiState>({ kind: "idle" });
  const [fileError, setFileError] = useState<string | null>(null);
  const busy = state.kind === "uploading";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0] ?? null;
    const problem = checkImportFile(file);
    setFileError(problem);
    if (problem || !file) return;
    setState({ kind: "uploading" });
    const body = new FormData();
    body.set("kind", item.kind);
    body.set("file", file);
    try {
      const res = await fetch("/api/v1/imports", { method: "POST", body, credentials: "same-origin" });
      const json: unknown = await res.json().catch(() => null);
      setState(importResponseState(res.status, json));
    } catch {
      setState({ kind: "failed", message: "The upload did not reach WonderID. Check your connection and try again." });
    }
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-md focus:outline-none"
          onEscapeKeyDown={(e) => busy && e.preventDefault()}
          onInteractOutside={(e) => busy && e.preventDefault()}
        >
          <Dialog.Title className="text-sm font-semibold">{item.title}</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            Required columns: {item.required.join(", ")}.{" "}
            <a href={item.templateHref} download className="text-primary hover:underline" title={[...item.required, ...item.optional].join(", ")}>
              Download the template
            </a>{" "}
            for the rest.
          </Dialog.Description>

          {state.kind === "started" ? (
            <div className="mt-4" role="status">
              <p className="text-sm font-medium text-foreground">
                {state.rows.toLocaleString()} {state.rows === 1 ? "row" : "rows"} received by the File imports connection
                {state.synced ? " and synced." : "; syncing in the background."}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                They appear on this page once that connection is reconciled.{" "}
                <Link href={state.integrationId ? `/integrations/${state.integrationId}` : "/integrations/jobs"} className="text-primary hover:underline">
                  Open the connection
                </Link>
                .
              </p>
              <div className="mt-4 flex justify-end">
                <Button variant="secondary" onClick={onClose}>
                  Close
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-4 space-y-3">
              <div>
                <label htmlFor={inputId} className="mb-1 block text-xs font-medium text-muted-foreground">
                  CSV file (up to 10 MB)
                </label>
                <input
                  id={inputId}
                  ref={fileRef}
                  type="file"
                  name="file"
                  accept=".csv,text/csv"
                  disabled={busy}
                  onChange={() => {
                    setFileError(null);
                    if (state.kind !== "idle") setState({ kind: "idle" });
                  }}
                  aria-invalid={fileError ? true : undefined}
                  className="block w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-2 file:py-1 file:text-sm file:text-secondary-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                />
                {fileError ? <p className="mt-1 text-xs text-destructive">{fileError}</p> : null}
              </div>

              {state.kind === "invalid" || state.kind === "failed" ? (
                <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  <p>{state.message}</p>
                  {state.kind === "invalid" && state.details.length > 0 ? (
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">
                      {state.details.map((d, i) => (
                        <li key={i}>{describeIssue(d)}</li>
                      ))}
                      {state.more > 0 ? <li>…and {state.more} more.</li> : null}
                    </ul>
                  ) : null}
                </div>
              ) : null}

              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy} aria-busy={busy}>
                  {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                  {busy ? "Uploading…" : "Import"}
                </Button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
