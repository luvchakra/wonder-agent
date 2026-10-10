"use client";

import { useActionState } from "react";
import { restoreConfigAction, saveConfigAction, type ConfigFormState } from "@/app/actions/config";
import { Card, CardBody, CardHeader, PendingSubmitButton, fieldInputClass, fieldLabelClass } from "@/modules/ui";
import { CONFIG_SETTINGS, SECTIONS, type TenantConfig } from "@/lib/config/registry";
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
                      {s.type === "choice" ? (
                        <select id={id} name={s.key} defaultValue={String(value)} disabled={!editable} aria-invalid={error ? true : undefined} className={cn(fieldInputClass, "max-w-[10rem]")}>
                          {s.options.map((o) => (
                            <option key={o} value={o}>
                              {o}
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
                          defaultValue={value}
                          disabled={!editable}
                          aria-invalid={error ? true : undefined}
                          aria-describedby={`${id}-help`}
                          className={cn(fieldInputClass, "max-w-[8rem]")}
                        />
                      )}
                      <span className="text-sm text-muted-foreground">{s.unit}</span>
                    </div>
                    <p id={`${id}-help`} className="mt-1 text-xs text-muted-foreground">
                      {s.help} Default {s.default}.{editable ? "" : " You can view this but not change it."}
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
