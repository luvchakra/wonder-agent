"use client";

import { useActionState } from "react";
import { importBundleAction, previewBundleAction, restoreConfigAction, saveConfigAction, type BundleFormState, type ConfigFormState } from "@/app/actions/config";
import { Card, CardBody, CardHeader, PendingSubmitButton, fieldInputClass, fieldLabelClass } from "@/modules/ui";
import { CONFIG_SETTINGS, SECTIONS, optionLabel, type TenantConfig } from "@/lib/config/registry";
import { cn } from "@/lib/utils";

const initial: ConfigFormState = { ok: false, message: null };

function Notice({ state }: { state: ConfigFormState }) {
  if (!state.message) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      className={cn(
        "rounded-md border px-3 py-2 text-sm",
        state.ok ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive/10 text-destructive",
      )}
    >
      {state.message}
    </p>
  );
}

/** Every setting, grouped by section; one Save. Settings the member can't change are shown, not editable. */
export function ConfigForm({ config, permissions }: { config: TenantConfig; permissions: string[] }) {
  const [state, action] = useActionState(saveConfigAction, initial);
  const can = (perm: readonly string[]) => perm.some((p) => permissions.includes(p));
  const anyEditable = CONFIG_SETTINGS.some((s) => can(s.permission));
  return (
    <form action={action} className="space-y-4">
      {SECTIONS.map((section) => {
        const settings = CONFIG_SETTINGS.filter((s) => s.section === section.key);
        return (
          <Card key={section.key}>
            <CardHeader title={section.title} description={section.description} />
            <CardBody className="grid gap-4 md:grid-cols-2">
              {settings.map((s) => {
                const editable = can(s.permission);
                const id = `cfg-${s.key.replace(/\W+/g, "-")}`;
                const error = state.errors?.[s.key];
                const value = config[s.key as keyof TenantConfig];
                return (
                  <div key={s.key}>
                    <label htmlFor={id} className={fieldLabelClass}>
                      {s.label}
                    </label>
                    <div className="flex items-center gap-2">
                      {s.type === "hosts" ? (
                        <textarea
                          id={id}
                          name={s.key}
                          rows={3}
                          defaultValue={(value as readonly string[]).join("\n")}
                          placeholder="api.example.com"
                          disabled={!editable}
                          aria-invalid={error ? true : undefined}
                          aria-describedby={`${id}-help`}
                          className={cn(fieldInputClass, "h-auto min-h-[4.5rem] py-2 font-mono text-xs")}
                        />
                      ) : s.type === "choice" ? (
                        <select id={id} name={s.key} defaultValue={String(value)} disabled={!editable} aria-invalid={error ? true : undefined} className={cn(fieldInputClass, "max-w-[10rem]")}>
                          {s.options.map((o) => (
                            <option key={o} value={o}>
                              {optionLabel(s, o)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          id={id}
                          name={s.key}
                          type="number"
                          inputMode="numeric"
                          min={s.min}
                          max={s.max}
                          step={1}
                          required
                          defaultValue={value as number}
                          disabled={!editable}
                          aria-invalid={error ? true : undefined}
                          aria-describedby={`${id}-help`}
                          className={cn(fieldInputClass, "max-w-[8rem]")}
                        />
                      )}
                      <span className="text-sm text-muted-foreground">{s.unit}</span>
                    </div>
                    <p id={`${id}-help`} className="mt-1 text-xs text-muted-foreground">
                      {s.help}
                      {s.type === "hosts" ? "" : ` Default ${optionLabel(s, s.default)}.`}
                      {editable ? "" : " You can view this but not change it."}
                    </p>
                    {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
                  </div>
                );
              })}
            </CardBody>
          </Card>
        );
      })}
      <Notice state={state} />
      {anyEditable ? (
        <PendingSubmitButton pendingLabel="Saving…">Save changes</PendingSubmitButton>
      ) : null}
    </form>
  );
}

/** Restores one earlier version. */
export function RestoreVersionButton({ version }: { version: number }) {
  const [state, action] = useActionState(restoreConfigAction, initial);
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="version" value={version} />
      <PendingSubmitButton size="sm" variant="outline" pendingLabel="Restoring…">
        Restore
      </PendingSubmitButton>
      {state.message ? <span className={cn("text-xs", state.ok ? "text-success" : "text-destructive")}>{state.message}</span> : null}
    </form>
  );
}

const BUNDLE_IDLE: BundleFormState = { step: "idle" };

/**
 * PLATFORM-P0-13 — import a configuration file exported from another
 * environment: Preview shows what would change, Import applies it as a
 * new version. The file is checked again on import.
 */
export function ConfigBundleImport() {
  const [previewState, preview] = useActionState(previewBundleAction, BUNDLE_IDLE);
  const [importState, apply] = useActionState(importBundleAction, BUNDLE_IDLE);
  const shown = importState.step !== "idle" ? importState : previewState;
  return (
    <div className="space-y-3">
      <form action={preview} className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="bundle" className={fieldLabelClass}>
            Configuration file
          </label>
          <input id="bundle" name="bundle" type="file" accept="application/json,.json" required className={cn(fieldInputClass, "h-auto py-1.5")} />
        </div>
        <PendingSubmitButton pendingLabel="Checking…" variant="outline">
          Preview
        </PendingSubmitButton>
      </form>
      {shown.step === "error" ? (
        <p role="alert" className="text-sm text-destructive">
          {shown.message}
        </p>
      ) : null}
      {shown.step === "done" ? (
        <p role="status" className="text-sm text-success">
          {shown.message}
        </p>
      ) : null}
      {shown.step === "preview" ? (
        <form action={apply} className="space-y-3 rounded-md border border-border p-3">
          <input type="hidden" name="bundleText" value={shown.text} />
          <p className="text-sm text-muted-foreground">
            From {shown.source}, exported {shown.exportedAt.slice(0, 16).replace("T", " ")} UTC.
          </p>
          {shown.changes.length ? (
            <ul className="space-y-0.5 text-sm" aria-label="Changes the import makes">
              {shown.changes.map((c) => (
                <li key={c.label}>
                  {c.label}: {c.from} → {c.to}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm">This organization already has these settings.</p>
          )}
          {shown.changes.length ? (
            <PendingSubmitButton pendingLabel="Importing…">Import {shown.changes.length === 1 ? "1 change" : `${shown.changes.length} changes`}</PendingSubmitButton>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
