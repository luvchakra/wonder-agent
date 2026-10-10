"use client";

import { useActionState } from "react";
import {
  connectSystemAction,
  setConnectorCredentialsAction,
  type ConnectorFormState,
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

function SettingInput({ s }: { s: SettingField }) {
  const name = `setting.${s.key}`;
  if (s.type === "select")
    return (
      <SelectField label={s.label} name={name} defaultValue={String(s.default ?? s.options?.[0] ?? "")} hint={s.help}>
        {s.options?.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </SelectField>
    );
  if (s.key === "caCertificate" || (s.type === "string" && /certificate/i.test(s.label)))
    return <TextareaField label={s.label} name={name} rows={3} hint={s.help} placeholder="-----BEGIN CERTIFICATE-----" />;
  return (
    <TextField
      label={s.label}
      name={name}
      required={s.required}
      type={s.type === "number" ? "number" : "text"}
      inputMode={s.type === "url" ? "url" : undefined}
      defaultValue={s.default === undefined ? undefined : String(s.default)}
      hint={s.help}
    />
  );
}

function SecretInputs({ fields }: { fields: SecretField[] }) {
  return (
    <>
      {fields.map((f) => (
        <TextField key={f.key} label={f.label} name={`secret.${f.key}`} type="password" autoComplete="off" required hint={f.help} />
      ))}
    </>
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

export function ConnectorCredentialsForm({ integrationId, secretFields }: { integrationId: string; secretFields: SecretField[] }) {
  const [state, action] = useActionState(setConnectorCredentialsAction.bind(null, integrationId), IDLE);
  return (
    <form action={action} className="space-y-4">
      <SecretInputs fields={secretFields} />
      <Outcome state={state} />
      <PendingSubmitButton variant="secondary" pendingLabel="Testing the connection…">
        Save credentials
      </PendingSubmitButton>
    </form>
  );
}
