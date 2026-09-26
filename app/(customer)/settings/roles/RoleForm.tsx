"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { saveRoleAction, type RoleActionState } from "@/app/actions/customRoles";
import { Button, Card, CardBody, PendingSubmitButton, fieldInputClass, fieldLabelClass } from "@/modules/ui";
import { cn } from "@/lib/utils";

/**
 * FOUNDATION-P0-25 — the custom role wizard (spec §15–17, 21; mockups 5–8):
 * basic details (or a copy of another role), permissions grouped by
 * product module with search, select-all and collapse, then review. One
 * form: the steps only show and hide, and the server validates everything
 * again — including that the role gains no permission its designer lacks,
 * which the form also shows (such permissions are disabled, with why).
 * Scope and conditions arrive with the authorization engine (FOUNDATION-P0-19).
 */

export type FormPermission = { key: string; label: string; description: string; resource: string; module: string; moduleLabel: string; sensitivity: string };
type Initial = { roleId?: string; name: string; description: string; permissions: string[]; copyFrom?: { id: string; name: string } | null };

const STEPS = ["Basic details", "Permissions", "Review"] as const;
const initialState: RoleActionState = { ok: false, message: null };

export function RoleForm({ catalog, actorHolds, initial, mode }: { catalog: FormPermission[]; actorHolds: string[]; initial: Initial; mode: "create" | "edit" }) {
  const [state, formAction] = useActionState(saveRoleAction, initialState);
  const [step, setStep] = useState(0);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [selected, setSelected] = useState<Set<string>>(new Set(initial.permissions));
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const holds = useMemo(() => new Set(actorHolds), [actorHolds]);
  const original = useMemo(() => new Set(mode === "edit" ? initial.permissions : []), [initial.permissions, mode]);
  // A permission is choosable if the designer holds it, or the role already had it (editing).
  const choosable = (key: string) => holds.has(key) || original.has(key);
  const errors = state.errors ?? {};
  const shownStep = state.errors && (errors.name || errors.description) && step === 2 ? 0 : state.errors && errors.permissions && step === 2 ? 1 : step;

  const modules = useMemo(() => {
    const q = query.trim().toLowerCase();
    const groups = new Map<string, { label: string; items: FormPermission[] }>();
    for (const p of catalog) {
      if (q && !(p.key.includes(q) || p.label.toLowerCase().includes(q) || p.description.toLowerCase().includes(q))) continue;
      if (!groups.has(p.module)) groups.set(p.module, { label: p.moduleLabel, items: [] });
      groups.get(p.module)!.items.push(p);
    }
    return [...groups.entries()];
  }, [catalog, query]);

  const toggle = (key: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else if (choosable(key)) n.add(key);
      return n;
    });
  const setAll = (items: FormPermission[], on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      for (const p of items) {
        if (on && choosable(p.key)) n.add(p.key);
        if (!on) n.delete(p.key);
      }
      return n;
    });
  const next = () => {
    if (shownStep === 0 && (name.trim().length < 3 || !description.trim())) {
      (document.getElementById(name.trim().length < 3 ? "role-name" : "role-description") as HTMLInputElement | null)?.reportValidity();
      return;
    }
    setStep(Math.min(shownStep + 1, 2));
  };
  const selectedList = catalog.filter((p) => selected.has(p.key));
  const unheld = catalog.filter((p) => !choosable(p.key)).length;

  return (
    <Card>
      <CardBody className="space-y-6 p-5 sm:p-6">
        <ol className="flex flex-wrap items-center gap-x-6 gap-y-2" aria-label="Steps">
          {STEPS.map((label, i) => (
            <li key={label} className="flex items-center gap-2 text-sm" aria-current={i === shownStep ? "step" : undefined}>
              <span
                className={cn(
                  "flex size-7 items-center justify-center rounded-full border text-xs font-semibold",
                  i < shownStep ? "border-primary bg-primary text-primary-foreground" : i === shownStep ? "border-primary text-primary" : "border-border text-muted-foreground",
                )}
              >
                {i < shownStep ? <Check className="size-3.5" aria-hidden="true" /> : i + 1}
              </span>
              <span className={i === shownStep ? "font-medium text-foreground" : "text-muted-foreground"}>{label}</span>
            </li>
          ))}
        </ol>

        <form action={formAction} className="space-y-6">
          {initial.roleId ? <input type="hidden" name="roleId" value={initial.roleId} /> : null}
          {initial.copyFrom ? <input type="hidden" name="copyFrom" value={initial.copyFrom.id} /> : null}
          {[...selected].map((k) => (
            <input key={k} type="hidden" name="permissions" value={k} />
          ))}

          <fieldset hidden={shownStep !== 0} className="max-w-2xl space-y-4">
            <legend className="sr-only">Basic details</legend>
            {initial.copyFrom ? (
              <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                Copying <span className="font-medium text-foreground">{initial.copyFrom.name}</span>: its permissions are pre-selected; adjust them in the next step.
              </p>
            ) : null}
            <div>
              <label htmlFor="role-name" className={fieldLabelClass}>
                Role name
              </label>
              <input
                id="role-name"
                name="name"
                required
                minLength={3}
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={fieldInputClass}
                aria-invalid={!!errors.name}
              />
              {errors.name ? <p className="mt-1 text-xs text-destructive">{errors.name}</p> : null}
            </div>
            <div>
              <label htmlFor="role-description" className={fieldLabelClass}>
                Description
              </label>
              <textarea
                id="role-description"
                name="description"
                required
                maxLength={500}
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className={fieldInputClass}
                aria-invalid={!!errors.description}
              />
              {errors.description ? <p className="mt-1 text-xs text-destructive">{errors.description}</p> : null}
            </div>
          </fieldset>

          <fieldset hidden={shownStep !== 1} className="space-y-3">
            <legend className="text-sm font-semibold text-foreground">
              Permissions <span className="font-normal text-muted-foreground">({selected.size} selected)</span>
            </legend>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                aria-label="Search permissions"
                placeholder="Search permissions"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className={cn(fieldInputClass, "max-w-sm")}
              />
              <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Clear all
              </Button>
            </div>
            {unheld ? (
              <p className="text-xs text-muted-foreground">
                {unheld} permission{unheld === 1 ? " is" : "s are"} unavailable: a role can only include permissions you hold yourself.
              </p>
            ) : null}
            {errors.permissions ? <p className="text-xs text-destructive">{errors.permissions}</p> : null}
            <div className="space-y-3">
              {modules.map(([module, group]) => {
                const open = !collapsed.has(module) || !!query;
                const count = group.items.filter((p) => selected.has(p.key)).length;
                return (
                  <section key={module} className="rounded-lg border border-border">
                    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() =>
                          setCollapsed((c) => {
                            const n = new Set(c);
                            if (n.has(module)) n.delete(module);
                            else n.add(module);
                            return n;
                          })
                        }
                        className="flex items-center gap-1.5 text-sm font-semibold text-foreground"
                      >
                        {open ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
                        {group.label}
                        <span className="font-normal text-muted-foreground">
                          ({count}/{group.items.length})
                        </span>
                      </button>
                      <span className="flex gap-1">
                        <Button type="button" size="sm" variant="ghost" onClick={() => setAll(group.items, true)} aria-label={`Select all in ${group.label}`}>
                          Select all
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setAll(group.items, false)} aria-label={`Clear ${group.label}`}>
                          Clear
                        </Button>
                      </span>
                    </div>
                    {open ? (
                      <ul className="divide-y divide-border border-t border-border">
                        {group.items.map((p) => {
                          const disabled = !choosable(p.key);
                          return (
                            <li key={p.key}>
                              <label className={cn("flex items-start gap-3 px-4 py-2.5 text-sm", disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-accent/50")}>
                                <input
                                  type="checkbox"
                                  checked={selected.has(p.key)}
                                  disabled={disabled && !selected.has(p.key)}
                                  onChange={() => toggle(p.key)}
                                  aria-label={p.label}
                                  className="mt-0.5 size-4 accent-[var(--primary)]"
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block text-foreground">{p.label}</span>
                                  <span className="block text-xs text-muted-foreground">{p.description}</span>
                                </span>
                                <span className="hidden text-xs text-muted-foreground sm:block">{p.resource}</span>
                                {p.sensitivity === "privileged" ? <span className="text-xs font-medium text-destructive">Privileged</span> : null}
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </section>
                );
              })}
              {modules.length === 0 ? <p className="text-sm text-muted-foreground">No permission matches.</p> : null}
            </div>
          </fieldset>

          <section hidden={shownStep !== 2} aria-label="Review" className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 rounded-lg border border-border p-4 text-sm">
              <p className="font-medium text-foreground">{name || "—"}</p>
              <p className="text-muted-foreground">Custom role{initial.copyFrom ? `, copied from ${initial.copyFrom.name}` : ""}</p>
              <p className="text-foreground">{description || "—"}</p>
              <p className="text-xs text-muted-foreground">Scope: the whole organization. Conditions: none.</p>
            </div>
            <div className="rounded-lg border border-border p-4 text-sm">
              <p className="font-medium text-foreground">Permissions ({selectedList.length})</p>
              {selectedList.length ? (
                <ul className="mt-2 space-y-1">
                  {selectedList.map((p) => (
                    <li key={p.key} className="flex gap-2">
                      <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden="true" />
                      <span className="text-foreground">{p.label}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-destructive">Choose at least one permission.</p>
              )}
            </div>
          </section>

          {state.message ? (
            <p
              role="alert"
              className={cn(
                "rounded-md border px-3 py-2 text-sm",
                state.ok ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive/10 text-destructive",
              )}
            >
              {state.message}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            {shownStep === 0 ? (
              <Link href={initial.roleId ? `/settings/roles/${initial.roleId}` : "/settings/roles"} className="text-sm text-muted-foreground hover:text-foreground">
                Cancel
              </Link>
            ) : (
              <Button type="button" variant="outline" onClick={() => setStep(shownStep - 1)}>
                Back
              </Button>
            )}
            {shownStep < 2 ? (
              <Button type="button" onClick={next}>
                Next
              </Button>
            ) : (
              <PendingSubmitButton pendingLabel="Saving…">{mode === "edit" ? "Save role" : "Create role"}</PendingSubmitButton>
            )}
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
