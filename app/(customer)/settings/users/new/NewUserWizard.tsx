"use client";

import { useActionState, useRef, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { inviteUserAction, type ActionState } from "@/app/actions/users";
import { Button, Card, CardBody, PendingSubmitButton, fieldInputClass, fieldLabelClass } from "@/modules/ui";
import { cn } from "@/lib/utils";

/**
 * FOUNDATION-P0-23 — the Add New User wizard (mockups 2–3). One form: the
 * steps only show and hide their fields, so nothing typed is lost moving
 * back and forth, and the server receives — and validates — everything at
 * once. Server-side errors bring the person back to the step that has them.
 */

type RoleOption = { name: string; label: string };
const STEPS = ["Basic details", "Roles", "Review"] as const;
const initial: ActionState = { ok: false, message: null };

export function NewUserWizard({ roles, canInvite, canAdd, canAssignRoles }: { roles: RoleOption[]; canInvite: boolean; canAdd: boolean; canAssignRoles: boolean }) {
  const [state, formAction] = useActionState(inviteUserAction, initial);
  const [step, setStep] = useState(0);
  const [roleQuery, setRoleQuery] = useState("");
  const [values, setValues] = useState({
    displayName: "",
    email: "",
    jobTitle: "",
    department: "",
    accountType: "internal",
    authMethod: "tenant_default",
    method: canInvite ? "invite" : "add",
    roles: [] as string[],
  });
  const detailsRef = useRef<HTMLFieldSetElement>(null);
  const errors = state.errors ?? {};
  // A server error on a basic-details field reopens that step.
  const shownStep = state.errors && (errors.email || errors.displayName || errors.accountType || errors.authMethod || errors.method) && step === 2 ? 0 : step;

  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setValues((v) => ({ ...v, [k]: e.target.value }));
  const toggleRole = (name: string) => setValues((v) => ({ ...v, roles: v.roles.includes(name) ? v.roles.filter((r) => r !== name) : [...v.roles, name] }));
  const next = () => {
    if (shownStep === 0) {
      const inputs = detailsRef.current?.querySelectorAll("input, select") ?? [];
      for (const el of inputs) if (!(el as HTMLInputElement).reportValidity()) return;
    }
    setStep(Math.min(shownStep + 1, STEPS.length - 1));
  };
  const visibleRoles = roles.filter((r) => !roleQuery || r.label.toLowerCase().includes(roleQuery.toLowerCase()) || r.name.toLowerCase().includes(roleQuery.toLowerCase()));

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
          {/* Everything travels with the form, whichever step is showing. */}
          {values.roles.map((r) => (
            <input key={r} type="hidden" name="roles" value={r} />
          ))}

          <fieldset ref={detailsRef} hidden={shownStep !== 0} className="grid gap-6 lg:grid-cols-2">
            <legend className="sr-only">Basic details</legend>
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-foreground">User information</h2>
              <div>
                <label htmlFor="displayName" className={fieldLabelClass}>
                  Full name
                </label>
                <input
                  id="displayName"
                  name="displayName"
                  required
                  maxLength={120}
                  value={values.displayName}
                  onChange={set("displayName")}
                  className={fieldInputClass}
                  aria-invalid={!!errors.displayName}
                />
                {errors.displayName ? <p className="mt-1 text-xs text-destructive">{errors.displayName}</p> : null}
              </div>
              <div>
                <label htmlFor="email" className={fieldLabelClass}>
                  Email address
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  maxLength={254}
                  value={values.email}
                  onChange={set("email")}
                  className={fieldInputClass}
                  aria-invalid={!!errors.email}
                />
                {errors.email ? <p className="mt-1 text-xs text-destructive">{errors.email}</p> : null}
              </div>
              <div>
                <label htmlFor="jobTitle" className={fieldLabelClass}>
                  Job title <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <input id="jobTitle" name="jobTitle" maxLength={200} value={values.jobTitle} onChange={set("jobTitle")} className={fieldInputClass} />
              </div>
              <div>
                <label htmlFor="department" className={fieldLabelClass}>
                  Department <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <input id="department" name="department" maxLength={200} value={values.department} onChange={set("department")} className={fieldInputClass} />
              </div>
            </div>

            <div className="space-y-5">
              <h2 className="text-sm font-semibold text-foreground">Account settings</h2>
              <RadioGroup
                legend="Account type"
                name="accountType"
                value={values.accountType}
                onChange={set("accountType")}
                options={[
                  { value: "internal", label: "Internal user", hint: "Employee or contractor on your payroll" },
                  { value: "external", label: "External user", hint: "Partner, vendor or auditor" },
                ]}
                footnote={
                  <>
                    Service accounts are machine identities —{" "}
                    <Link href="/identities/machines" className="text-primary hover:underline">
                      register them there
                    </Link>
                    .
                  </>
                }
              />
              <RadioGroup
                legend="Authentication method"
                name="authMethod"
                value={values.authMethod}
                onChange={set("authMethod")}
                options={[
                  { value: "tenant_default", label: "Use the organization default" },
                  { value: "password", label: "Email and password" },
                  { value: "sso", label: "Single sign-on only" },
                ]}
              />
              <RadioGroup
                legend="How they join"
                name="method"
                value={values.method}
                onChange={set("method")}
                options={[
                  ...(canInvite ? [{ value: "invite", label: "Send an invitation", hint: "They become active when they accept" }] : []),
                  ...(canAdd ? [{ value: "add", label: "Add to the organization now", hint: "Active immediately; they set a password to sign in" }] : []),
                ]}
              />
            </div>
          </fieldset>

          <fieldset hidden={shownStep !== 1} className="space-y-3">
            <legend className="text-sm font-semibold text-foreground">Select roles</legend>
            {canAssignRoles ? (
              <>
                <input
                  type="search"
                  aria-label="Search roles"
                  placeholder="Search roles"
                  value={roleQuery}
                  onChange={(e) => setRoleQuery(e.target.value)}
                  className={cn(fieldInputClass, "max-w-sm")}
                />
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {visibleRoles.map((r) => (
                    <li key={r.name}>
                      <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent/50">
                        <input type="checkbox" checked={values.roles.includes(r.name)} onChange={() => toggleRole(r.name)} className="size-4 accent-[var(--primary)]" />
                        <span className="flex-1 font-medium text-foreground">{r.label}</span>
                        <span className="text-xs text-muted-foreground">System</span>
                      </label>
                    </li>
                  ))}
                  {visibleRoles.length === 0 ? <li className="px-4 py-3 text-sm text-muted-foreground">No role matches.</li> : null}
                </ul>
                {errors.roles ? <p className="text-xs text-destructive">{errors.roles}</p> : null}
                <p className="text-xs text-muted-foreground">Roles grant access only while the membership is active. Scoped assignments arrive with the authorization engine.</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">You can add people, but assigning roles needs role management. An administrator can assign roles afterwards.</p>
            )}
          </fieldset>

          <section hidden={shownStep !== 2} aria-label="Review" className="grid gap-4 md:grid-cols-2">
            <dl className="space-y-2 rounded-lg border border-border p-4 text-sm">
              <Row label="Name" value={values.displayName} />
              <Row label="Email" value={values.email} />
              <Row label="Job title" value={values.jobTitle || "—"} />
              <Row label="Department" value={values.department || "—"} />
              <Row label="Account type" value={values.accountType === "external" ? "External user" : "Internal user"} />
              <Row label="Sign-in" value={{ tenant_default: "Organization default", password: "Email and password", sso: "Single sign-on only" }[values.authMethod] ?? ""} />
              <Row label="Joins" value={values.method === "invite" ? "By invitation" : "Now, as active"} />
            </dl>
            <div className="rounded-lg border border-border p-4 text-sm">
              <p className="font-medium text-foreground">Roles</p>
              {values.roles.length ? (
                <ul className="mt-2 space-y-1">
                  {values.roles.map((r) => (
                    <li key={r} className="text-foreground">
                      {roles.find((x) => x.name === r)?.label ?? r}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-muted-foreground">No roles — they will have no access until one is assigned.</p>
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
              <Link href="/settings/users" className="text-sm text-muted-foreground hover:text-foreground">
                Cancel
              </Link>
            ) : (
              <Button type="button" variant="outline" onClick={() => setStep(shownStep - 1)}>
                Back
              </Button>
            )}
            {shownStep < STEPS.length - 1 ? (
              <Button type="button" onClick={next}>
                Next
              </Button>
            ) : (
              <PendingSubmitButton pendingLabel={values.method === "invite" ? "Inviting…" : "Adding…"}>
                {values.method === "invite" ? "Send invitation" : "Add user"}
              </PendingSubmitButton>
            )}
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-28 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{value}</dd>
    </div>
  );
}

function RadioGroup({
  legend,
  name,
  value,
  onChange,
  options,
  footnote,
}: {
  legend: string;
  name: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  options: { value: string; label: string; hint?: string }[];
  footnote?: React.ReactNode;
}) {
  return (
    <fieldset>
      <legend className={fieldLabelClass}>{legend}</legend>
      <div className="space-y-2">
        {options.map((o) => (
          <label key={o.value} className="flex cursor-pointer items-start gap-2.5 text-sm">
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={onChange} className="mt-0.5 size-4 accent-[var(--primary)]" />
            <span>
              <span className="block text-foreground">{o.label}</span>
              {o.hint ? <span className="block text-xs text-muted-foreground">{o.hint}</span> : null}
            </span>
          </label>
        ))}
      </div>
      {footnote ? <p className="mt-2 text-xs text-muted-foreground">{footnote}</p> : null}
    </fieldset>
  );
}
