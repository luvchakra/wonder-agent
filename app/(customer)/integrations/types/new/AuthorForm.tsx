"use client";

import { useActionState, useMemo, useState } from "react";
import { previewDefinitionAction, publishDefinitionAction, type ConnectorFormState, type PreviewState } from "@/app/actions/connectors";
import { validateDefinition } from "@/modules/integrations/framework/validate";
import { RESOURCE_KINDS, type ConnectorDefinition, type ResourceKind } from "@/modules/integrations/framework/types";
import { PendingSubmitButton, SelectField, TabPanel, Tabs, TextareaField } from "@/modules/ui";
import { samplePaths } from "@/modules/ui/connectorEditor";
import { GuidedForm } from "./GuidedForm";

const IDLE: ConnectorFormState = { status: "idle" };
const PREVIEW_IDLE: PreviewState = { status: "idle" };

/**
 * Checks a definition as it is typed (the same rules the server applies),
 * tries it, and publishes it. EXPERIENCE-P0-30: the form and the JSON edit
 * the same text, so what is published is the same either way.
 */
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
  // The form needs the JSON to parse; it may still have issues to fix.
  const parsed = useMemo(() => {
    try {
      const v = JSON.parse(text);
      return v && typeof v === "object" && v.resources && typeof v.resources === "object" && v.auth && Array.isArray(v.settings) ? (v as ConnectorDefinition) : null;
    } catch {
      return null;
    }
  }, [text]);
  const [chosenKind, setKind] = useState<ResourceKind | null>(null);
  const formKinds = parsed ? RESOURCE_KINDS.filter((k) => parsed.resources[k]) : [];
  const kind = chosenKind && formKinds.includes(chosenKind) ? chosenKind : (formKinds[0] ?? null);
  const samples = preview.status === "done" && preview.result.samples.length ? samplePaths(preview.result.samples[0]) : [];

  return (
    <div className="space-y-4">
      <Tabs ariaLabel="Edit as" tabs={[{ value: "form", label: "Form" }, { value: "json", label: "JSON" }]}>
        <TabPanel value="form" className="pt-4">
          {parsed ? (
            <GuidedForm def={parsed} onChange={(next) => setText(JSON.stringify(next, null, 2))} kind={kind} onKind={setKind} samples={samples} />
          ) : (
            <p className="text-sm text-muted-foreground">Fix the JSON to use the form.</p>
          )}
        </TabPanel>
        <TabPanel value="json" className="space-y-3 pt-4">
          <label className="block text-sm text-muted-foreground">
            {/* INTEGRATION-P0-21: a definition exported elsewhere opens here, to check and publish as usual. */}
            Open a definition file{" "}
            <input
              type="file"
              accept="application/json,.json"
              className="mt-1 block text-sm text-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-secondary file:px-3 file:py-1 file:text-sm file:text-secondary-foreground"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file && file.size <= 512_000) setText(await file.text());
              }}
            />
          </label>
          <TextareaField label="Definition (JSON)" name="definition-json" rows={22} spellCheck={false} className="font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} />
        </TabPanel>
      </Tabs>
      <form action={publish} className="space-y-3">
        <input type="hidden" name="definition" value={text} />
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
          <SelectField label="Resource" name="resource" disabled={kinds.length === 0} value={kind && kinds.includes(kind) ? kind : kinds[0]} onChange={(e) => setKind(e.target.value as ResourceKind)}>
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
