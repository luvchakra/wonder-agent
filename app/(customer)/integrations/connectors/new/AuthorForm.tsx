"use client";

import { useActionState, useMemo, useState } from "react";
import { previewDefinitionAction, publishDefinitionAction, type ConnectorFormState, type PreviewState } from "@/app/actions/connectors";
import { validateDefinition } from "@/modules/integrations/framework/validate";
import { RESOURCE_KINDS } from "@/modules/integrations/framework/types";
import { PendingSubmitButton, SelectField, TextareaField } from "@/modules/ui";

const IDLE: ConnectorFormState = { status: "idle" };
const PREVIEW_IDLE: PreviewState = { status: "idle" };

/** Checks a definition as it is typed (the same rules the server applies), tries it, and publishes it. */
export function AuthorForm({ initial }: { initial: string }) {
  const [text, setText] = useState(initial);
  const [published, publish] = useActionState(publishDefinitionAction, IDLE);
  const [preview, runPreview] = useActionState(previewDefinitionAction, PREVIEW_IDLE);
  const check = useMemo(() => {
    try {
      return validateDefinition(JSON.parse(text));
    } catch {
      return { definition: null, issues: [{ path: "", message: "is not valid JSON" }] };
    }
  }, [text]);
  const kinds = check.definition ? RESOURCE_KINDS.filter((k) => check.definition!.resources[k]) : [];

  return (
    <div className="space-y-4">
      <form action={publish} className="space-y-3">
        <TextareaField
          label="Definition (JSON)"
          name="definition"
          rows={22}
          spellCheck={false}
          className="font-mono text-xs"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {check.issues.length ? (
          <ul role="alert" className="list-disc space-y-0.5 pl-5 text-sm text-destructive">
            {check.issues.slice(0, 8).map((i, n) => (
              <li key={n}>
                <code>{i.path || "definition"}</code> {i.message}
              </li>
            ))}
            {check.issues.length > 8 ? <li>{check.issues.length - 8} more</li> : null}
          </ul>
        ) : (
          <p role="status" className="text-sm text-success">
            Valid: {check.definition!.name} v{check.definition!.version}
          </p>
        )}
        {published.status === "error" ? (
          <p role="alert" className="text-sm text-destructive">
            {published.message}
          </p>
        ) : null}
        <PendingSubmitButton pendingLabel="Publishing…">Publish</PendingSubmitButton>
      </form>

      <details className="rounded-lg border border-border p-4">
        <summary className="cursor-pointer text-sm font-medium text-foreground">Try it against a system</summary>
        <form action={runPreview} className="mt-3 space-y-3">
          <input type="hidden" name="definition" value={text} />
          <TextareaField label="Settings (JSON)" name="settings" rows={3} spellCheck={false} className="font-mono text-xs" placeholder='{ "baseUrl": "https://…" }' />
          <TextareaField
            label="Secret values (JSON)"
            name="secret"
            rows={2}
            spellCheck={false}
            autoComplete="off"
            className="font-mono text-xs"
            hint="Used for this one request and never stored"
          />
          <SelectField label="Resource" name="resource" disabled={kinds.length === 0}>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </SelectField>
          <PendingSubmitButton variant="secondary" pendingLabel="Fetching…">
            Preview
          </PendingSubmitButton>
          {preview.status === "error" ? (
            <p role="alert" className="text-sm text-destructive">
              {preview.message}
            </p>
          ) : null}
          {preview.status === "done" ? (
            <div role="status" className="space-y-2 text-sm">
              <p className={preview.result.ok ? "text-foreground" : "text-destructive"}>
                {preview.result.ok ? `${preview.result.count} ${preview.result.resource} records.` : preview.result.message}
                {preview.result.issues.length ? ` ${preview.result.issues.length} could not be mapped: ${preview.result.issues[0].message}` : ""}
              </p>
              {preview.result.records.length ? (
                <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 font-mono text-xs text-foreground">{JSON.stringify(preview.result.records, null, 2)}</pre>
              ) : null}
            </div>
          ) : null}
        </form>
      </details>
    </div>
  );
}
