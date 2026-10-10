"use client";

import { useActionState } from "react";
import {
  connectSystemAction,
  rotateReceiverSecretAction,
  setConnectorCredentialsAction,
  updateConnectorSettingsAction,
  type ConnectorFormState,
  type ReceiverSecretState,
} from "@/app/actions/connectors";
import type { DefinitionOrigin } from "@/modules/integrations/framework/catalog";
import type { SecretField, SettingField } from "@/modules/integrations/framework/types";
import { PendingSubmitButton, SelectField, TextField, TextareaField } from "@/modules/ui";

const IDLE: ConnectorFormState = { status: "idle" };

function Outcome({ state }: { state: ConnectorFormState }) {
  if (state.status === "idle") return null;
  return (
    <p role={state.status === "error" ? "alert" : "status"} className={state.status === "error" ? "text-sm text-destructive" : "text-sm text-success"}>
      {state.message}
    </p>
  );
}

function SettingInput({ s, value }: { s: SettingField; value?: string | number | boolean }) {
  const name = `setting.${s.key}`;
  const current = value === undefined ? s.default : value;
  if (s.type === "select")
    return (
      <SelectField label={s.label} name={name} defaultValue={String(current ?? s.options?.[0] ?? "")} hint={s.help}>
        {s.options?.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </SelectField>
    );
  if (s.key === "caCertificate" || (s.type === "string" && /certificate/i.test(s.label)))
    return <TextareaField label={s.label} name={name} rows={3} hint={s.help} placeholder="-----BEGIN CERTIFICATE-----" defaultValue={current === undefined ? undefined : String(current)} />;
  return (
    <TextField
      label={s.label}
      name={name}
      required={s.required}
      type={s.type === "number" ? "number" : "text"}
      inputMode={s.type === "url" ? "url" : undefined}
      defaultValue={current === undefined ? undefined : String(current)}
      hint={s.help}
    />
  );
}

/**
 * Secret fields. With `saved` (the connection's page), each shows its
 * stored value masked, never blank, and an empty field keeps it (owner
 * decision, 2026-10-10).
 */
function SecretInputs({ fields, saved }: { fields: SecretField[]; saved?: Record<string, string> }) {
  return (
    <>
      {fields.map((f) => {
        const current = saved?.[f.key] ?? "";
        const hint = saved ? `${current ? `Saved: ${current}. ` : "Not saved. "}${current ? "Leave empty to keep it. " : ""}${f.help ?? ""}`.trim() : f.help;
        return <TextField key={f.key} label={f.label} name={`secret.${f.key}`} type="password" autoComplete="off" required={!f.optional && !current} hint={hint} />;
      })}
    </>
  );
}

/**
 * A connection's name and every setting its connection type declares, as
 * configured. With integration.update the values can be changed; without
 * it they are shown as they are.
 */
export function ConnectorSettingsForm(props: { integrationId: string; name: string; settings: SettingField[]; values: Record<string, string | number | boolean | undefined>; canEdit: boolean }) {
  const [state, action] = useActionState(updateConnectorSettingsAction.bind(null, props.integrationId), IDLE);
  if (!props.canEdit) {
    return (
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">Name</dt>
          <dd className="text-foreground">{props.name}</dd>
        </div>
        {props.settings.map((s) => (
          <div key={s.key} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{s.label}</dt>
            <dd className="break-words text-foreground">{props.values[s.key] === undefined || props.values[s.key] === "" ? <span className="text-muted-foreground">Not set</span> : String(props.values[s.key])}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <form action={action} className="space-y-4">
      <TextField label="Name" name="name" required maxLength={120} defaultValue={props.name} />
      {props.settings.map((s) => (
        <SettingInput key={s.key} s={s} value={props.values[s.key]} />
      ))}
      <Outcome state={state} />
      <PendingSubmitButton variant="secondary" pendingLabel="Saving…">
        Save settings
      </PendingSubmitButton>
    </form>
  );
}

/** Settings and credentials for one connector; the credentials are tested before they are stored. */
export function ConnectForm(props: {
  origin: DefinitionOrigin;
  connectorKey: string;
  version: string;
  defaultName: string;
  settings: SettingField[];
  secretFields: SecretField[];
}) {
  const [state, action] = useActionState(connectSystemAction.bind(null, props.origin, props.connectorKey), IDLE);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="version" value={props.version} />
      <TextField label="Name" name="name" required maxLength={120} defaultValue={props.defaultName} />
      {props.settings.map((s) => (
        <SettingInput key={s.key} s={s} />
      ))}
      <SecretInputs fields={props.secretFields} />
      <Outcome state={state} />
      <PendingSubmitButton pendingLabel="Testing the connection…">Connect</PendingSubmitButton>
    </form>
  );
}

export function ConnectorCredentialsForm({ integrationId, secretFields, saved }: { integrationId: string; secretFields: SecretField[]; saved: Record<string, string> }) {
  const [state, action] = useActionState(setConnectorCredentialsAction.bind(null, integrationId), IDLE);
  return (
    <form action={action} className="space-y-4">
      <SecretInputs fields={secretFields} saved={saved} />
      <Outcome state={state} />
      <PendingSubmitButton variant="secondary" pendingLabel="Testing the connection…">
        Save credentials
      </PendingSubmitButton>
    </form>
  );
}

/** Issues the receiving secret, or replaces it (the old one stops working at once). Shown once. */
export function ReceiverSecretForm({ integrationId, hasSecret }: { integrationId: string; hasSecret: boolean }) {
  const [state, action] = useActionState(rotateReceiverSecretAction.bind(null, integrationId), { status: "idle" } as ReceiverSecretState);
  return (
    <form action={action} className="space-y-2">
      {state.status === "issued" ? (
        <div role="status" className="space-y-1">
          <p className="text-foreground">Copy this secret now. It is not shown again.</p>
          <code className="block break-all rounded bg-muted px-2 py-1 text-xs text-foreground">{state.secret}</code>
        </div>
      ) : null}
      {state.status === "error" ? (
        <p role="alert" className="text-destructive">
          {state.message}
        </p>
      ) : null}
      <PendingSubmitButton variant="secondary" pendingLabel="Issuing…">
        {hasSecret || state.status === "issued" ? "Replace secret" : "Issue secret"}
      </PendingSubmitButton>
    </form>
  );
}
