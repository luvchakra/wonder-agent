"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  addRelationshipAction,
  closeLifecycleTaskAction,
  createAttributeDefinitionAction,
  transitionLifecycleAction,
  createIdentityAction,
  endRelationshipAction,
  setAttributeActiveAction,
  updateIdentityAction,
  type IdentityFormState,
} from "@/app/actions/identities";
import { Button, SelectField, TextField, TextareaField, fieldInputClass, fieldLabelClass } from "@/modules/ui";
import {
  IDENTITY_STATUSES,
  IDENTITY_TYPES,
  MACHINE_IDENTITY_TYPES,
  type IdentityAttributeDefinition,
  type IdentityType,
} from "@/lib/shared/types/agent-identity";
import { IDENTITY_TYPE_LABEL, RELATIONSHIP_LABEL, STATUS_LABEL } from "./labels";

const IDLE: IdentityFormState = { status: "idle" };

export type PersonOption = { id: string; displayName: string; email: string | null };
export type IdentityOption = { id: string; displayName: string; identityType: IdentityType };

function Result({ state }: { state: IdentityFormState }) {
  return (
    <p role="status" className="min-h-5 text-xs">
      {state.status === "saved" ? <span className="text-success">{state.message}</span> : null}
      {state.status === "error" ? <span className="text-destructive">{state.message}</span> : null}
    </p>
  );
}

function Submit({ pending, idle, busy, variant = "default" }: { pending: boolean; idle: string; busy: string; variant?: "default" | "secondary" | "outline" }) {
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
      {pending ? busy : idle}
    </Button>
  );
}

function PersonSelect({ label, name, people, defaultValue, required, hint }: { label: string; name: string; people: PersonOption[]; defaultValue?: string | null; required?: boolean; hint?: string }) {
  return (
    <SelectField label={label} name={name} defaultValue={defaultValue ?? ""} required={required} hint={hint}>
      <option value="">{required ? "Choose a person" : "None"}</option>
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.displayName}
          {p.email && p.email !== p.displayName ? ` (${p.email})` : ""}
        </option>
      ))}
    </SelectField>
  );
}

const isMachine = (t: string) => (MACHINE_IDENTITY_TYPES as readonly string[]).includes(t);

/**
 * Inputs for the tenant's attributes that apply to `identityType`, named
 * attr.<name>. `attributesPresent` tells the action the form rendered
 * them, so an update without them leaves stored values alone.
 */
function AttributeInputs({
  definitions,
  identityType,
  values,
}: {
  definitions: IdentityAttributeDefinition[];
  identityType: string;
  values?: Record<string, unknown>;
}) {
  const applicable = definitions.filter((d) => d.active && (d.identityType === null || d.identityType === identityType));
  if (!applicable.length) return null;
  return (
    <fieldset className="sm:col-span-2">
      <legend className="text-sm font-medium text-foreground">Attributes</legend>
      <input type="hidden" name="attributesPresent" value="1" />
      <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {applicable.map((d) => {
          const name = `attr.${d.name}`;
          const current = values?.[d.name];
          const value = current === undefined || current === null ? "" : String(current);
          if (d.dataType === "enum" || d.dataType === "boolean") {
            const options = d.dataType === "boolean" ? ["true", "false"] : d.allowedValues;
            return (
              <SelectField key={d.id} label={d.displayName} name={name} defaultValue={value} required={d.required}>
                <option value="">{d.required ? "Choose…" : "Not set"}</option>
                {options.map((o) => (
                  <option key={o} value={o}>
                    {d.dataType === "boolean" ? (o === "true" ? "Yes" : "No") : o}
                  </option>
                ))}
              </SelectField>
            );
          }
          return (
            <TextField
              key={d.id}
              label={d.displayName}
              name={name}
              defaultValue={value}
              required={d.required}
              type={d.dataType === "number" ? "number" : d.dataType === "date" ? "date" : "text"}
              step={d.dataType === "number" ? "any" : undefined}
              autoComplete={d.sensitive ? "off" : undefined}
              hint={d.sensitive ? "Sensitive: shown only to identity administrators" : undefined}
            />
          );
        })}
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------- create

export function NewIdentityForm({
  people,
  definitions,
  initialType,
}: {
  people: PersonOption[];
  definitions: IdentityAttributeDefinition[];
  initialType: string;
}) {
  const [state, action, pending] = useActionState(createIdentityAction, IDLE);
  const [type, setType] = useState(initialType);
  const person = type === "HUMAN" || type === "EXTERNAL";
  return (
    <form action={action} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <SelectField label="Identity type" name="identityType" value={type} onChange={(e) => setType(e.target.value)} required>
        {IDENTITY_TYPES.filter((t) => t !== "AI_AGENT").map((t) => (
          <option key={t} value={t}>
            {IDENTITY_TYPE_LABEL[t]}
          </option>
        ))}
      </SelectField>
      <TextField label="Subtype" name="subtype" maxLength={60} placeholder={person ? "employee, contractor, vendor…" : "batch job, CI runner, integration…"} />
      <div className="sm:col-span-2">
        <TextField label={person ? "Full name" : "Name"} name="displayName" required maxLength={200} />
      </div>
      <TextField label="Username / account name" name="username" maxLength={200} autoComplete="off" />
      <TextField label="Email" name="email" type="email" maxLength={320} autoComplete="off" />

      {type === "EXTERNAL" ? (
        <>
          <PersonSelect label="Sponsor" name="sponsorIdentityId" people={people} required hint="The person accountable for this external identity" />
          <TextField label="Organization" name="organization" required maxLength={200} placeholder="Their company" />
        </>
      ) : null}
      {isMachine(type) ? (
        <div className="sm:col-span-2">
          <PersonSelect label="Owner" name="ownerIdentityId" people={people} required hint="Every machine identity has an accountable owner" />
        </div>
      ) : null}
      {person ? (
        <>
          <PersonSelect label="Manager" name="managerIdentityId" people={people} />
          <TextField label="Job title" name="title" maxLength={200} />
          <TextField label="Department" name="department" maxLength={200} />
          <TextField label="Location" name="location" maxLength={200} />
        </>
      ) : (
        <div className="sm:col-span-2">
          <TextareaField label="Purpose" name="purpose" maxLength={2000} rows={2} placeholder="What this identity is for" />
        </div>
      )}
      <TextField label="Start date" name="startDate" type="date" />
      <TextField label={type === "EXTERNAL" ? "End date" : "End date (optional)"} name="endDate" type="date" required={type === "EXTERNAL"} hint={type === "EXTERNAL" ? "External access is time-bound" : undefined} />
      <label className="flex items-center gap-2 text-sm text-foreground sm:col-span-2">
        <input type="hidden" name="privilegedPresent" value="1" />
        <input type="checkbox" name="privileged" className="size-4 accent-primary" />
        Privileged identity
      </label>
      <AttributeInputs key={type} definitions={definitions} identityType={type} />
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Submit pending={pending} idle="Create identity" busy="Creating…" />
        <Result state={state} />
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- edit

export type EditableIdentity = {
  id: string;
  identityType: IdentityType;
  displayName: string;
  username: string | null;
  email: string | null;
  subtype: string | null;
  status: string;
  ownerIdentityId: string | null;
  sponsorIdentityId: string | null;
  managerIdentityId: string | null;
  department: string | null;
  title: string | null;
  location: string | null;
  organization: string | null;
  purpose: string | null;
  startDate: string | null;
  endDate: string | null;
  privileged: boolean;
  attributes: Record<string, unknown>;
  /** A member's name and email come from their sign-in account. */
  accountLinked: boolean;
};

export function EditIdentityForm({ identity, people, definitions }: { identity: EditableIdentity; people: PersonOption[]; definitions: IdentityAttributeDefinition[] }) {
  const [state, action, pending] = useActionState(updateIdentityAction.bind(null, identity.id), IDLE);
  const t = identity.identityType;
  const person = t === "HUMAN" || t === "EXTERNAL";

  if (t === "AI_AGENT") {
    return (
      <form action={action} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <PersonSelect label="Accountable owner" name="ownerIdentityId" people={people} defaultValue={identity.ownerIdentityId} />
        <PersonSelect label="Sponsor" name="sponsorIdentityId" people={people} defaultValue={identity.sponsorIdentityId} />
        <AttributeInputs definitions={definitions} identityType={t} values={identity.attributes} />
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Submit pending={pending} idle="Save" busy="Saving…" />
          <Result state={state} />
        </div>
      </form>
    );
  }

  return (
    <form action={action} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {identity.accountLinked ? null : (
        <>
          <div className="sm:col-span-2">
            <TextField label={person ? "Full name" : "Name"} name="displayName" required maxLength={200} defaultValue={identity.displayName} />
          </div>
          <TextField label="Username / account name" name="username" maxLength={200} defaultValue={identity.username ?? ""} autoComplete="off" />
          <TextField label="Email" name="email" type="email" maxLength={320} defaultValue={identity.email ?? ""} autoComplete="off" />
        </>
      )}
      <SelectField label="Status" name="status" defaultValue={identity.status}>
        {IDENTITY_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </SelectField>
      <TextField label="Subtype" name="subtype" maxLength={60} defaultValue={identity.subtype ?? ""} />
      {t === "EXTERNAL" ? (
        <>
          <PersonSelect label="Sponsor" name="sponsorIdentityId" people={people} required defaultValue={identity.sponsorIdentityId} />
          <TextField label="Organization" name="organization" required maxLength={200} defaultValue={identity.organization ?? ""} />
        </>
      ) : null}
      {isMachine(t) ? <PersonSelect label="Owner" name="ownerIdentityId" people={people} required defaultValue={identity.ownerIdentityId} /> : null}
      {person ? (
        <>
          <PersonSelect label="Manager" name="managerIdentityId" people={people} defaultValue={identity.managerIdentityId} />
          <TextField label="Job title" name="title" maxLength={200} defaultValue={identity.title ?? ""} />
          <TextField label="Department" name="department" maxLength={200} defaultValue={identity.department ?? ""} />
          <TextField label="Location" name="location" maxLength={200} defaultValue={identity.location ?? ""} />
        </>
      ) : (
        <div className="sm:col-span-2">
          <TextareaField label="Purpose" name="purpose" maxLength={2000} rows={2} defaultValue={identity.purpose ?? ""} />
        </div>
      )}
      <TextField label="Start date" name="startDate" type="date" defaultValue={identity.startDate ?? ""} />
      <TextField label="End date" name="endDate" type="date" required={t === "EXTERNAL"} defaultValue={identity.endDate ?? ""} />
      <label className="flex items-center gap-2 text-sm text-foreground sm:col-span-2">
        <input type="hidden" name="privilegedPresent" value="1" />
        <input type="checkbox" name="privileged" defaultChecked={identity.privileged} className="size-4 accent-primary" />
        Privileged identity
      </label>
      <AttributeInputs definitions={definitions} identityType={t} values={identity.attributes} />
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Submit pending={pending} idle="Save changes" busy="Saving…" />
        <Result state={state} />
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- relationships

export function AddRelationshipForm({ identityId, candidates }: { identityId: string; candidates: IdentityOption[] }) {
  const [state, action, pending] = useActionState(addRelationshipAction.bind(null, identityId), IDLE);
  return (
    <form action={action} className="grid grid-cols-1 gap-3 md:grid-cols-4 md:items-end">
      <SelectField label="Direction" name="direction" defaultValue="outgoing">
        <option value="outgoing">This identity …</option>
        <option value="incoming">… this identity</option>
      </SelectField>
      <SelectField label="Relationship" name="relationshipType" defaultValue="owns" required>
        {Object.entries(RELATIONSHIP_LABEL).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </SelectField>
      <SelectField label="Other identity" name="otherIdentityId" defaultValue="" required>
        <option value="">Choose an identity</option>
        {candidates
          .filter((c) => c.id !== identityId)
          .map((c) => (
            <option key={c.id} value={c.id}>
              {c.displayName} · {IDENTITY_TYPE_LABEL[c.identityType]}
            </option>
          ))}
      </SelectField>
      <TextField label="Until (optional)" name="validTo" type="date" />
      <div className="flex flex-wrap items-center gap-3 md:col-span-4">
        <Submit pending={pending} idle="Add relationship" busy="Adding…" variant="secondary" />
        <Result state={state} />
      </div>
    </form>
  );
}

export function EndRelationshipButton({ identityId, relationshipId, label }: { identityId: string; relationshipId: string; label: string }) {
  const [state, action, pending] = useActionState(endRelationshipAction.bind(null, identityId, relationshipId), IDLE);
  return (
    <form action={action} className="flex items-center gap-2">
      <Button type="submit" size="sm" variant="outline" disabled={pending} aria-label={`End relationship: ${label}`}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        End
      </Button>
      {state.status === "error" ? <span className="text-xs text-destructive">{state.message}</span> : null}
    </form>
  );
}

// ---------------------------------------------------------------- attribute definitions

export function AttributeDefinitionForm() {
  const [state, action, pending] = useActionState(createAttributeDefinitionAction, IDLE);
  const [dataType, setDataType] = useState("string");
  return (
    <form action={action} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <TextField label="Display name" name="displayName" required maxLength={120} placeholder="Cost center" />
      <TextField label="Key" name="name" required maxLength={63} pattern="[a-z][a-z0-9_]{0,62}" placeholder="cost_center" hint="Lower-case letters, digits and underscores" />
      <SelectField label="Applies to" name="identityType" defaultValue="">
        <option value="">Every identity type</option>
        {IDENTITY_TYPES.map((t) => (
          <option key={t} value={t}>
            {IDENTITY_TYPE_LABEL[t]}
          </option>
        ))}
      </SelectField>
      <SelectField label="Data type" name="dataType" value={dataType} onChange={(e) => setDataType(e.target.value)}>
        <option value="string">Text</option>
        <option value="number">Number</option>
        <option value="boolean">Yes / no</option>
        <option value="date">Date</option>
        <option value="enum">Choice list</option>
      </SelectField>
      {dataType === "enum" ? (
        <div className="sm:col-span-2">
          <TextField label="Allowed values" name="allowedValues" required placeholder="EMEA, AMER, APAC" hint="Separate with commas" />
        </div>
      ) : null}
      {dataType === "string" ? (
        <div className="sm:col-span-2">
          <TextField label="Format rule (optional)" name="validationRegex" maxLength={300} placeholder="^CC-[0-9]{4}$" hint="A regular expression every value must match" className="font-mono" />
        </div>
      ) : null}
      <fieldset className="flex flex-wrap gap-x-5 gap-y-2 sm:col-span-2">
        <legend className="sr-only">Options</legend>
        {[
          ["required", "Required"],
          ["sensitive", "Sensitive"],
          ["searchable", "Searchable"],
          ["uniqueValue", "Unique"],
        ].map(([name, label]) => (
          <label key={name} className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" name={name} className="size-4 accent-primary" />
            {label}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Submit pending={pending} idle="Add attribute" busy="Adding…" />
        <Result state={state} />
      </div>
    </form>
  );
}

export function AttributeActiveButton({ definitionId, active, label }: { definitionId: string; active: boolean; label: string }) {
  const [state, action, pending] = useActionState(setAttributeActiveAction.bind(null, definitionId, !active), IDLE);
  return (
    <form action={action} className="flex items-center justify-end gap-2">
      {state.status === "error" ? <span className="text-xs text-destructive">{state.message}</span> : null}
      <Button type="submit" size="sm" variant="outline" disabled={pending} aria-label={`${active ? "Retire" : "Restore"} ${label}`}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        {active ? "Retire" : "Restore"}
      </Button>
    </form>
  );
}

/** Search box for the directory; a plain GET form so the URL carries the view. */
export function DirectorySearch({ defaultValue }: { defaultValue: string }) {
  return (
    <div className="sm:w-72">
      <label htmlFor="q" className={fieldLabelClass}>
        Search
      </label>
      <input id="q" type="search" name="q" defaultValue={defaultValue} placeholder="Name, email or account" className={fieldInputClass} />
    </div>
  );
}

// ---------------------------------------------------------------- lifecycle (IDENTITY-P0-18)

export type TransitionOption = { toState: string; label: string; needsReason: boolean };

export function LifecycleTransitionForm({ identityId, options }: { identityId: string; options: TransitionOption[] }) {
  const [state, action, pending] = useActionState(transitionLifecycleAction.bind(null, identityId), IDLE);
  const [choice, setChoice] = useState(options[0]?.toState ?? "");
  const needsReason = options.find((o) => o.toState === choice)?.needsReason ?? false;
  if (!options.length) return <p className="text-sm text-muted-foreground">No further lifecycle step from here.</p>;
  return (
    <form action={action} className="grid grid-cols-1 gap-3 md:grid-cols-[14rem_1fr_auto] md:items-end">
      <SelectField label="Next step" name="toState" value={choice} onChange={(e) => setChoice(e.target.value)}>
        {options.map((o) => (
          <option key={o.toState} value={o.toState}>
            {o.label}
          </option>
        ))}
      </SelectField>
      <TextField label={needsReason ? "Reason" : "Note (optional)"} name="note" required={needsReason} maxLength={2000} placeholder={needsReason ? "Why, for the record" : ""} />
      <Submit pending={pending} idle="Apply" busy="Applying…" />
      <div className="md:col-span-3">
        <Result state={state} />
      </div>
    </form>
  );
}

export function LifecycleTaskActions({ taskId, taskType, people }: { taskId: string; taskType: string; people: PersonOption[] }) {
  const [state, action, pending] = useActionState(closeLifecycleTaskAction.bind(null, taskId), IDLE);
  const [mode, setMode] = useState<"done" | "skipped" | "transfer">(taskType === "transfer_ownership" ? "transfer" : "done");
  return (
    <form action={action} className="space-y-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-foreground" role="radiogroup" aria-label="Close this task">
        {taskType === "transfer_ownership" ? (
          <label className="flex items-center gap-1.5">
            <input type="radio" name="action" value="transfer" checked={mode === "transfer"} onChange={() => setMode("transfer")} className="accent-primary" />
            Transfer
          </label>
        ) : null}
        <label className="flex items-center gap-1.5">
          <input type="radio" name="action" value="done" checked={mode === "done"} onChange={() => setMode("done")} className="accent-primary" />
          Done
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" name="action" value="skipped" checked={mode === "skipped"} onChange={() => setMode("skipped")} className="accent-primary" />
          Not needed
        </label>
      </div>
      {mode === "transfer" ? (
        <select name="toIdentityId" aria-label="New owner" required className={fieldInputClass} defaultValue="">
          <option value="">Choose the new owner</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
              {p.email && p.email !== p.displayName ? ` (${p.email})` : ""}
            </option>
          ))}
        </select>
      ) : (
        <input name="note" aria-label="Note" required={mode === "skipped"} maxLength={2000} placeholder={mode === "skipped" ? "Why it is not needed" : "What was done (optional)"} className={fieldInputClass} />
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {mode === "transfer" ? "Transfer ownership" : "Close task"}
        </Button>
        <Result state={state} />
      </div>
    </form>
  );
}
