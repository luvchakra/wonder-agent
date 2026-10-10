"use client";

import { useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowRight, ChevronDown, Download, Loader2, Upload } from "lucide-react";
import { Button } from "./Button";
import { Badge, type BadgeTone } from "./Badge";
import {
  DECISION_LABEL,
  checkImportFile,
  columnLabel,
  describeIssue,
  importResultState,
  importableRows,
  outcomeSummary,
  previewResponseState,
  type ImportPreview,
  type ImportUiState,
  type PreviewDecision,
  type PreviewRow,
} from "./importCsv";

export type ObjectExportItem = { label: string; href: string };
export type ObjectImportItem = { kind: string; scope: string; label: string; title: string; required: string[]; optional: string[]; templateHref: string };

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

const DECISION_TONE: Record<PreviewDecision, BadgeTone> = { new: "success", update: "info", unchanged: "neutral", invalid: "danger", review: "warning" };
const FILTERS: { key: "all" | "changes" | "problems"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "changes", label: "New and updates" },
  { key: "problems", label: "Not imported" },
];

/**
 * Import in three steps (2026-10-10, user decision): choose a file; see a
 * preview of every record laid out in the page's own columns, with what
 * would be added, updated, left as it is or not imported; then confirm or
 * cancel. Nothing is stored before "Confirm import". Additive only: records
 * missing from the file are never removed or deactivated. The result says
 * what the import actually did, and the page's list is refreshed.
 */
function ImportCsvDialog({ item, onClose }: { item: ObjectImportItem; onClose: () => void }) {
  const router = useRouter();
  const inputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<ImportUiState>({ kind: "idle" });
  const [fileError, setFileError] = useState<string | null>(null);
  const busy = state.kind === "previewing" || state.kind === "importing";

  const form = (f: File) => {
    const body = new FormData();
    body.set("kind", item.kind);
    body.set("scope", item.scope);
    body.set("file", f);
    return body;
  };

  async function preview(e: React.FormEvent) {
    e.preventDefault();
    const chosen = fileRef.current?.files?.[0] ?? null;
    const problem = checkImportFile(chosen);
    setFileError(problem);
    if (problem || !chosen) return;
    setFile(chosen);
    setState({ kind: "previewing" });
    try {
      const res = await fetch("/api/v1/imports/preview", { method: "POST", body: form(chosen), credentials: "same-origin" });
      setState(previewResponseState(res.status, await res.json().catch(() => null)));
    } catch {
      setState({ kind: "failed", message: "The file did not reach WonderID. Check your connection and try again." });
    }
  }

  async function confirm() {
    if (state.kind !== "preview" || !file) return;
    setState({ kind: "importing", preview: state.preview });
    try {
      const res = await fetch("/api/v1/imports", { method: "POST", body: form(file), credentials: "same-origin" });
      const next = importResultState(res.status, await res.json().catch(() => null));
      setState(next);
      if (next.kind === "done") router.refresh();
    } catch {
      // The request may still have run; say so rather than guess.
      setState({ kind: "failed", message: "The import's answer did not arrive. Refresh the page to see whether the records were imported before trying again." });
    }
  }

  const shownPreview = state.kind === "preview" || state.kind === "importing" ? state.preview : null;
  const wide = shownPreview !== null || state.kind === "done";

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
          className={
            "fixed left-1/2 top-1/2 z-50 flex max-h-[min(48rem,calc(100dvh-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-md focus:outline-none " +
            (wide ? "w-[min(72rem,calc(100vw-2rem))]" : "w-[min(30rem,calc(100vw-2rem))]")
          }
          onEscapeKeyDown={(e) => busy && e.preventDefault()}
          onInteractOutside={(e) => busy && e.preventDefault()}
        >
          <Dialog.Title className="text-sm font-semibold">{item.title}</Dialog.Title>

          {state.kind === "done" ? (
            <ImportResult outcome={state.outcome} onClose={onClose} />
          ) : shownPreview ? (
            <PreviewStep
              preview={shownPreview}
              filename={file?.name ?? ""}
              importing={state.kind === "importing"}
              onConfirm={confirm}
              onBack={() => {
                setState({ kind: "idle" });
                setFile(null);
              }}
              onCancel={onClose}
            />
          ) : (
            <>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                Required columns: {item.required.join(", ")}.{" "}
                <a href={item.templateHref} download className="text-primary hover:underline" title={[...item.required, ...item.optional].join(", ")}>
                  Download the template
                </a>{" "}
                for the rest. You see a preview before anything is imported.
              </Dialog.Description>
              <form onSubmit={preview} className="mt-4 space-y-3">
                <div>
                  <label htmlFor={inputId} className="mb-1 block text-xs font-medium text-muted-foreground">
                    CSV file (up to 10 MB and 5,000 rows)
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
                    {busy ? "Reading the file…" : "Preview"}
                  </Button>
                </div>
              </form>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PreviewStep({
  preview,
  filename,
  importing,
  onConfirm,
  onBack,
  onCancel,
}: {
  preview: ImportPreview;
  filename: string;
  importing: boolean;
  onConfirm: () => void;
  onBack: () => void;
  onCancel: () => void;
}) {
  const [filter, setFilter] = useState<"all" | "changes" | "problems">("all");
  const rows = useMemo(
    () =>
      preview.shown.filter((r) =>
        filter === "all" ? true : filter === "changes" ? r.decision === "new" || r.decision === "update" : r.decision === "invalid" || r.decision === "review",
      ),
    [preview.shown, filter],
  );
  const importable = importableRows(preview);
  const { counts } = preview;
  const summary = (
    [
      ["new", counts.new],
      ["update", counts.update],
      ["unchanged", counts.unchanged],
      ["review", counts.review],
      ["invalid", counts.invalid],
    ] as [PreviewDecision, number][]
  ).filter(([, n]) => n > 0);

  return (
    <>
      <Dialog.Description className="mt-1 text-sm text-muted-foreground">
        {filename ? <span className="font-medium text-foreground">{filename}</span> : null} · {preview.rows.toLocaleString()} {preview.rows === 1 ? "row" : "rows"}. Nothing is imported until you confirm, and records
        missing from the file are left as they are.
      </Dialog.Description>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {summary.map(([d, n]) => (
          <Badge key={d} tone={DECISION_TONE[d]}>
            {n.toLocaleString()} {DECISION_LABEL[d].toLowerCase()}
          </Badge>
        ))}
        <div role="radiogroup" aria-label="Show rows" className="ml-auto flex rounded-md border border-border p-0.5 text-xs">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="radio"
              aria-checked={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={"rounded px-2 py-1 " + (filter === f.key ? "bg-secondary font-medium text-secondary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-md border border-border">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-muted text-left text-xs font-medium text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Row
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Result
              </th>
              {preview.columns.map((c) => (
                <th key={c} scope="col" className="px-3 py-2 font-medium">
                  {columnLabel(c)}
                </th>
              ))}
              <th scope="col" className="px-3 py-2 font-medium">
                Notes
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={preview.columns.length + 3} className="px-3 py-6 text-center text-muted-foreground">
                  No rows to show here.
                </td>
              </tr>
            ) : (
              rows.map((r, i) => <PreviewTableRow key={`${r.row}-${r.externalId}-${i}`} row={r} columns={preview.columns} />)
            )}
          </tbody>
        </table>
      </div>
      {preview.shown.length < preview.rows ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Showing {preview.shown.length.toLocaleString()} of {preview.rows.toLocaleString()} rows, rows that will not be imported first. The counts above cover the whole file.
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onBack} disabled={importing} className="mr-auto">
          Choose another file
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={importing}>
          Cancel import
        </Button>
        <Button type="button" onClick={onConfirm} disabled={importing || importable === 0} aria-busy={importing}>
          {importing ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {importing ? "Importing…" : importable === 0 ? "Nothing to import" : `Confirm import (${importable.toLocaleString()})`}
        </Button>
      </div>
    </>
  );
}

function PreviewTableRow({ row, columns }: { row: PreviewRow; columns: string[] }) {
  const changed = new Map(row.decision === "update" ? row.changes.map((c) => [c.field, c]) : []);
  const muted = row.decision === "invalid" || row.decision === "review" || row.decision === "unchanged";
  return (
    <tr className="border-t border-border align-top">
      <td className="px-3 py-2 tabular-nums text-muted-foreground">{row.row ?? "—"}</td>
      <td className="px-3 py-2">
        <Badge tone={DECISION_TONE[row.decision]}>{DECISION_LABEL[row.decision]}</Badge>
      </td>
      {columns.map((c) => {
        const change = changed.get(c);
        return (
          <td key={c} className={"max-w-[16rem] px-3 py-2 " + (change ? "bg-info/5" : "") + (muted ? " text-muted-foreground" : "")}>
            {change ? (
              <span className="inline-flex flex-wrap items-center gap-1">
                {change.from ? <span className="text-muted-foreground line-through">{change.from}</span> : <span className="text-muted-foreground">empty</span>}
                <ArrowRight className="size-3 text-muted-foreground" aria-label="changes to" />
                <span className="font-medium text-foreground">{change.to ?? "empty"}</span>
              </span>
            ) : (
              <span className="break-words">{row.values[c] || <span className="text-muted-foreground">—</span>}</span>
            )}
          </td>
        );
      })}
      <td className={"max-w-[20rem] px-3 py-2 text-xs " + (row.decision === "invalid" ? "text-destructive" : "text-muted-foreground")}>{row.note ?? ""}</td>
    </tr>
  );
}

function ImportResult({ outcome, onClose }: { outcome: Extract<ImportUiState, { kind: "done" }>["outcome"]; onClose: () => void }) {
  return (
    <div className="mt-3" role="status">
      <p className="text-sm font-medium text-foreground">{outcomeSummary(outcome)}</p>
      <p className="mt-1 text-sm text-muted-foreground">The list on this page is updated. Nothing missing from the file was removed or deactivated.</p>
      {outcome.problems.length > 0 ? (
        <details className="mt-3 rounded-md border border-border px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium">Rows not imported</summary>
          <ul className="mt-2 max-h-64 space-y-1 overflow-auto text-xs">
            {outcome.problems.map((p, i) => (
              <li key={i}>
                <span className="tabular-nums text-muted-foreground">{p.row !== null ? `Row ${p.row}` : p.externalId}</span>: {p.message}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className="mt-4 flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
