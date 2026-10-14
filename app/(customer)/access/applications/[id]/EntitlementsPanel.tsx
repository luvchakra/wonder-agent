"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Loader2, MoreHorizontal, Plus } from "lucide-react";
import { Badge, type BadgeTone } from "@/modules/ui/Badge";
import { Button } from "@/modules/ui/Button";
import { Card, CardBody, CardHeader } from "@/modules/ui/Card";
import { EmptyState } from "@/modules/ui/States";
import { TableContainer, Thead, Th, Td, Tr } from "@/modules/ui/Table";
import { fieldInputClass, fieldLabelClass } from "@/modules/ui/Field";
import type { ApplicationEntitlementType, Entitlement } from "@/lib/shared/types/access-governance";

/**
 * The application's Entitlements tab (owner feedback, 2026-10-14):
 * entitlements and their types as tables, each row with one menu (edit,
 * disable or enable, delete), and "Add" in the card header rather than a
 * form row at the end. Attributes follow how Saviynt models them: display
 * name, description, type, privilege, risk, classification, requestable,
 * certifiable, SOX, status. Everything is saved through the Access API
 * (access.manage), which validates, audits and refuses what it must; its
 * own message is shown.
 */

const MODE_LABEL: Record<ApplicationEntitlementType["requestMode"], string> = {
  single: "One at a time",
  multiple: "Several at once",
  free_text: "Free text",
  not_requestable: "Shown, not requestable",
};
const PRIVILEGE_TONE: Record<string, BadgeTone> = { standard: "neutral", elevated: "warning", admin: "danger" };
const RISK_TONE: Record<string, BadgeTone> = { low: "neutral", medium: "info", high: "warning", critical: "danger" };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

async function send(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<string | null> {
  const res = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  return !res.ok || !json.ok ? (json.error?.message ?? "It could not be saved") : null;
}

function Modal({ title, open, onOpenChange, children }: { title: string; open: boolean; onOpenChange: (open: boolean) => void; children: React.ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-lg border border-border bg-popover p-5 text-popover-foreground shadow-md focus:outline-none">
          <Dialog.Title className="text-base font-semibold text-foreground">{title}</Dialog.Title>
          <Dialog.Description className="sr-only">{title}</Dialog.Description>
          <div className="mt-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function RowMenu({ label, items }: { label: string; items: { label: string; onSelect: () => void; danger?: boolean }[] }) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="sm" aria-label={label} className="h-8 w-8 p-0">
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className="z-50 min-w-40 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg">
          {items.map((i) => (
            <DropdownMenu.Item
              key={i.label}
              onSelect={i.onSelect}
              className={
                "flex cursor-pointer items-center rounded-sm px-3 py-2 text-sm outline-none data-[highlighted]:bg-accent " + (i.danger ? "text-destructive" : "")
              }
            >
              {i.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function Labelled({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={"block " + (className ?? "")}>
      <span className={fieldLabelClass}>{label}</span>
      {children}
    </label>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-foreground">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 rounded border-input" />
      {label}
    </label>
  );
}

function FormActions({ pending, label, error, onCancel, disabled }: { pending: boolean; label: string; error: string | null; onCancel: () => void; disabled?: boolean }) {
  return (
    <>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || disabled} aria-busy={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {label}
        </Button>
      </div>
    </>
  );
}

type EntitlementDraft = {
  name: string;
  displayName: string;
  description: string;
  entitlementType: string;
  privilegeLevel: string;
  riskLevel: string;
  dataClassification: string;
  requestable: boolean;
  certifiable: boolean;
  soxRelevant: boolean;
};

function draftOf(e: Entitlement | null, defaultType: string): EntitlementDraft {
  return {
    name: e?.name ?? "",
    displayName: e?.displayName ?? "",
    description: e?.description ?? "",
    entitlementType: e?.entitlementType ?? defaultType,
    privilegeLevel: e?.privilegeLevel ?? "standard",
    riskLevel: e?.riskLevel ?? "",
    dataClassification: e?.dataClassification ?? "",
    requestable: e?.requestable ?? true,
    certifiable: e?.certifiable ?? true,
    soxRelevant: e?.soxRelevant ?? false,
  };
}

/** A new entitlement: created under its type, then the rest of its attributes set. */
async function createThenDescribe(applicationId: string, d: EntitlementDraft): Promise<string | null> {
  const res = await fetch(`/api/v1/access/applications/${applicationId}/entitlements`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: d.name.trim(), entitlementType: d.entitlementType, privilegeLevel: d.privilegeLevel }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) return json.error?.message ?? "It could not be added";
  return send(`/api/v1/access/entitlements/${json.data.id as string}`, "PATCH", {
    displayName: d.displayName,
    description: d.description,
    riskLevel: d.riskLevel,
    dataClassification: d.dataClassification,
    requestable: d.requestable,
    certifiable: d.certifiable,
    soxRelevant: d.soxRelevant,
  });
}

function EntitlementForm({ applicationId, entitlement, types, onDone }: { applicationId: string; entitlement: Entitlement | null; types: string[]; onDone: () => void }) {
  const router = useRouter();
  const [d, setD] = useState(() => draftOf(entitlement, types[0] ?? ""));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (patch: Partial<EntitlementDraft>) => setD({ ...d, ...patch });
  const typeChoices = entitlement?.entitlementType && !types.some((t) => t.toLowerCase() === entitlement.entitlementType!.toLowerCase()) ? [entitlement.entitlementType, ...types] : types;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const body = {
            ...(entitlement?.fromConnector ? {} : { name: d.name.trim() }),
            displayName: d.displayName,
            description: d.description,
            entitlementType: d.entitlementType,
            privilegeLevel: d.privilegeLevel,
            riskLevel: d.riskLevel,
            dataClassification: d.dataClassification,
            requestable: d.requestable,
            certifiable: d.certifiable,
            soxRelevant: d.soxRelevant,
          };
          const err = entitlement
            ? await send(`/api/v1/access/entitlements/${entitlement.id}`, "PATCH", body)
            : await createThenDescribe(applicationId, d);
          setError(err);
          if (!err) {
            router.refresh();
            onDone();
          }
        });
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Labelled label="Type" className="sm:col-span-2">
          <select required value={d.entitlementType} onChange={(e) => set({ entitlementType: e.target.value })} className={fieldInputClass} aria-label="Type of the entitlement">
            {typeChoices.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled label="Name">
          <input
            required
            maxLength={200}
            value={d.name}
            disabled={entitlement?.fromConnector}
            onChange={(e) => set({ name: e.target.value })}
            className={fieldInputClass}
            aria-label="Entitlement name"
          />
        </Labelled>
        <Labelled label="Display name">
          <input maxLength={200} value={d.displayName} onChange={(e) => set({ displayName: e.target.value })} className={fieldInputClass} aria-label="Display name" />
        </Labelled>
        <Labelled label="Description" className="sm:col-span-2">
          <textarea maxLength={2000} rows={2} value={d.description} onChange={(e) => set({ description: e.target.value })} className={fieldInputClass} aria-label="Description" />
        </Labelled>
        <Labelled label="Privilege">
          <select value={d.privilegeLevel} onChange={(e) => set({ privilegeLevel: e.target.value })} className={fieldInputClass} aria-label="Privilege">
            <option value="standard">Standard</option>
            <option value="elevated">Elevated</option>
            <option value="admin">Admin</option>
          </select>
        </Labelled>
        <Labelled label="Risk">
          <select value={d.riskLevel} onChange={(e) => set({ riskLevel: e.target.value })} className={fieldInputClass} aria-label="Risk">
            <option value="">Not set</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </Labelled>
        <Labelled label="Data classification" className="sm:col-span-2">
          <input maxLength={100} value={d.dataClassification} onChange={(e) => set({ dataClassification: e.target.value })} placeholder="e.g. confidential" className={fieldInputClass} aria-label="Data classification" />
        </Labelled>
        <div className="flex flex-wrap gap-x-6 gap-y-2 sm:col-span-2">
          <Check label="Requestable" checked={d.requestable} onChange={(v) => set({ requestable: v })} />
          <Check label="Certifiable" checked={d.certifiable} onChange={(v) => set({ certifiable: v })} />
          <Check label="SOX relevant" checked={d.soxRelevant} onChange={(v) => set({ soxRelevant: v })} />
        </div>
      </div>
      <FormActions pending={pending} label={entitlement ? "Save" : "Add entitlement"} error={error} onCancel={onDone} disabled={!d.name.trim() || !d.entitlementType} />
    </form>
  );
}

type TypeDraft = { name: string; displayName: string; description: string; requestMode: string; certifiable: boolean; defaultDurationDays: string; maxDurationDays: string };

function TypeForm({ applicationId, type, onDone }: { applicationId: string; type: ApplicationEntitlementType | null; onDone: () => void }) {
  const router = useRouter();
  const [d, setD] = useState<TypeDraft>({
    name: type?.name ?? "",
    displayName: type?.displayName ?? "",
    description: type?.description ?? "",
    requestMode: type?.requestMode ?? "single",
    certifiable: type?.certifiable ?? true,
    defaultDurationDays: type?.defaultDurationDays ? String(type.defaultDurationDays) : "",
    maxDurationDays: type?.maxDurationDays ? String(type.maxDurationDays) : "",
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (patch: Partial<TypeDraft>) => setD({ ...d, ...patch });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const body = {
            ...(type?.origin === "connector" ? {} : { name: d.name.trim() }),
            displayName: d.displayName,
            description: d.description,
            requestMode: d.requestMode,
            certifiable: d.certifiable,
            defaultDurationDays: d.defaultDurationDays,
            maxDurationDays: d.maxDurationDays,
          };
          const err = type
            ? await send(`/api/v1/access/applications/${applicationId}/entitlement-types/${type.id}`, "PATCH", body)
            : await send(`/api/v1/access/applications/${applicationId}/entitlement-types`, "POST", body);
          setError(err);
          if (!err) {
            router.refresh();
            onDone();
          }
        });
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Labelled label="Name">
          <input required maxLength={100} value={d.name} disabled={type?.origin === "connector"} onChange={(e) => set({ name: e.target.value })} className={fieldInputClass} aria-label="Type name" />
        </Labelled>
        <Labelled label="Display name">
          <input maxLength={200} value={d.displayName} onChange={(e) => set({ displayName: e.target.value })} className={fieldInputClass} aria-label="Type display name" />
        </Labelled>
        <Labelled label="Description" className="sm:col-span-2">
          <textarea maxLength={2000} rows={2} value={d.description} onChange={(e) => set({ description: e.target.value })} className={fieldInputClass} aria-label="Type description" />
        </Labelled>
        <Labelled label="Requested as" className="sm:col-span-2">
          <select value={d.requestMode} onChange={(e) => set({ requestMode: e.target.value })} className={fieldInputClass} aria-label="Requested as">
            {Object.entries(MODE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled label="Default days">
          <input inputMode="numeric" value={d.defaultDurationDays} onChange={(e) => set({ defaultDurationDays: e.target.value })} className={fieldInputClass} aria-label="Default days" />
        </Labelled>
        <Labelled label="Max days">
          <input inputMode="numeric" value={d.maxDurationDays} onChange={(e) => set({ maxDurationDays: e.target.value })} className={fieldInputClass} aria-label="Max days" />
        </Labelled>
        <div className="sm:col-span-2">
          <Check label="Certifiable" checked={d.certifiable} onChange={(v) => set({ certifiable: v })} />
        </div>
      </div>
      <FormActions pending={pending} label={type ? "Save" : "Add type"} error={error} onCancel={onDone} disabled={!d.name.trim()} />
    </form>
  );
}

function ConfirmDelete({ what, url, onDone, onDeleted }: { what: string; url: string; onDone: () => void; onDeleted: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const err = await send(url, "DELETE");
          setError(err);
          if (!err) {
            onDeleted();
            router.refresh();
            onDone();
          }
        });
      }}
    >
      <p className="text-sm text-muted-foreground">
        {what} is deleted permanently. If it is in use, WonderID refuses and you can disable it instead.
      </p>
      <FormActions pending={pending} label="Delete" error={error} onCancel={onDone} />
    </form>
  );
}

type Dialogs =
  | { kind: "entitlement"; entitlement: Entitlement | null }
  | { kind: "type"; type: ApplicationEntitlementType | null }
  | { kind: "delete"; what: string; url: string; id: string }
  | null;

export function EntitlementsPanel({
  applicationId,
  entitlements,
  total,
  types,
  canManage,
  fromConnector,
  requestability = {},
}: {
  /** Why each entitlement cannot be requested now (no policy, its policy, itself), or null when it can. */
  requestability?: Record<string, "no_policy" | "policy" | "entitlement" | null>;
  applicationId: string;
  entitlements: Entitlement[];
  total: number;
  types: ApplicationEntitlementType[];
  canManage: boolean;
  fromConnector: boolean;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  // What the server confirmed, shown at once while the page refreshes.
  const [removed, setRemoved] = useState<Set<string>>(() => new Set());
  const [statusOf, setStatusOf] = useState<Record<string, "active" | "inactive">>({});
  const close = () => setDialog(null);
  const activeTypes = types.filter((t) => t.status !== "inactive").map((t) => t.name);

  async function toggle(id: string, url: string, status: "active" | "inactive") {
    const err = await send(url, "PATCH", { status });
    setRowError(err);
    if (!err) setStatusOf((m) => ({ ...m, [id]: status }));
    router.refresh();
  }
  const shownEntitlements = entitlements.filter((e) => !removed.has(e.id));
  const shownTypes = types.filter((t) => !removed.has(t.id));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Entitlements"
          description={total > entitlements.length ? `The first ${entitlements.length} of ${total}.` : `${total} ${total === 1 ? "entitlement" : "entitlements"}`}
          actions={
            canManage && !fromConnector ? (
              <Button size="sm" onClick={() => setDialog({ kind: "entitlement", entitlement: null })} disabled={activeTypes.length === 0} title={activeTypes.length ? undefined : "Add an entitlement type first"}>
                <Plus className="size-4" aria-hidden="true" />
                Add entitlement
              </Button>
            ) : null
          }
        />
        <CardBody>
          {rowError ? (
            <p role="alert" className="mb-3 text-sm text-destructive">
              {rowError}
            </p>
          ) : null}
          {shownEntitlements.length === 0 ? (
            <EmptyState
              title="No entitlements"
              description={
                fromConnector
                  ? "They arrive when the connector is read."
                  : activeTypes.length
                    ? "Add the entitlements people can hold in this application."
                    : "To add an entitlement, first add an entitlement type below."
              }
            />
          ) : (
            <TableContainer label="Entitlements" bare>
              <Thead>
                <tr>
                  <Th>Entitlement</Th>
                  <Th>Type</Th>
                  <Th>Privilege</Th>
                  <Th hideBelow="lg">Risk</Th>
                  <Th hideBelow="xl">Classification</Th>
                  <Th hideBelow="lg">Governance</Th>
                  <Th>Status</Th>
                  {canManage ? <Th className="w-10" aria-label="Actions" /> : null}
                </tr>
              </Thead>
              <tbody>
                {shownEntitlements.map((e) => {
                  const url = `/api/v1/access/entitlements/${e.id}`;
                  const inactive = (statusOf[e.id] ?? e.status) === "inactive";
                  return (
                    <Tr key={e.id}>
                      <Td>
                        <span className={"block font-medium " + (inactive ? "text-muted-foreground" : "text-foreground")}>{e.displayName || e.name}</span>
                        {e.displayName ? <span className="block text-xs text-muted-foreground">{e.name}</span> : null}
                        {e.description ? <span className="block max-w-md truncate text-xs text-muted-foreground">{e.description}</span> : null}
                      </Td>
                      <Td>{e.entitlementType ? <Badge tone="info">{e.entitlementType}</Badge> : <span className="text-muted-foreground">—</span>}</Td>
                      <Td>
                        <Badge tone={PRIVILEGE_TONE[e.privilegeLevel] ?? "neutral"}>{cap(e.privilegeLevel)}</Badge>
                      </Td>
                      <Td hideBelow="lg">{e.riskLevel ? <Badge tone={RISK_TONE[e.riskLevel]}>{cap(e.riskLevel)}</Badge> : <span className="text-muted-foreground">—</span>}</Td>
                      <Td hideBelow="xl">{e.dataClassification ? cap(e.dataClassification) : <span className="text-muted-foreground">—</span>}</Td>
                      <Td hideBelow="lg">
                        <span className="flex flex-wrap gap-1">
                          {requestability[e.id] === "no_policy" ? (
                            <a href={`/access/request-policies?app=${applicationId}`} title="No request policy says who approves it" className="rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                              <Badge tone="warning">Needs a request policy</Badge>
                            </a>
                          ) : requestability[e.id] === "policy" || requestability[e.id] === "entitlement" || e.requestable === false ? (
                            <Badge tone="neutral">Not requestable</Badge>
                          ) : (
                            <Badge tone="success">Requestable</Badge>
                          )}
                          {e.certifiable === false ? <Badge tone="neutral">Not certified</Badge> : null}
                          {e.soxRelevant ? <Badge tone="warning">SOX</Badge> : null}
                        </span>
                      </Td>
                      <Td>
                        <Badge tone={inactive ? "neutral" : "success"}>{inactive ? "Disabled" : "Active"}</Badge>
                      </Td>
                      {canManage ? (
                        <Td className="text-right">
                          <RowMenu
                            label={`Actions for ${e.name}`}
                            items={[
                              { label: "Edit…", onSelect: () => setDialog({ kind: "entitlement", entitlement: e }) },
                              { label: inactive ? "Enable" : "Disable", onSelect: () => toggle(e.id, url, inactive ? "active" : "inactive") },
                              ...(e.fromConnector ? [] : [{ label: "Delete…", danger: true, onSelect: () => setDialog({ kind: "delete", what: `The entitlement “${e.name}”`, url, id: e.id }) }]),
                            ]}
                          />
                        </Td>
                      ) : null}
                    </Tr>
                  );
                })}
              </tbody>
            </TableContainer>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Entitlement types"
          description="How each kind of entitlement is requested and reviewed."
          actions={
            canManage ? (
              <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "type", type: null })}>
                <Plus className="size-4" aria-hidden="true" />
                Add type
              </Button>
            ) : null
          }
        />
        <CardBody>
          {shownTypes.length === 0 ? (
            <EmptyState title="No entitlement types" description="Types group entitlements (role, group, permission set) and set how they are requested." />
          ) : (
            <TableContainer label="Entitlement types" bare>
              <Thead>
                <tr>
                  <Th>Type</Th>
                  <Th>Requested as</Th>
                  <Th hideBelow="lg">Duration</Th>
                  <Th hideBelow="lg">Certifiable</Th>
                  <Th>Entitlements</Th>
                  <Th>Status</Th>
                  {canManage ? <Th className="w-10" aria-label="Actions" /> : null}
                </tr>
              </Thead>
              <tbody>
                {shownTypes.map((t) => {
                  const url = `/api/v1/access/applications/${applicationId}/entitlement-types/${t.id}`;
                  const inactive = (statusOf[t.id] ?? t.status) === "inactive";
                  return (
                    <Tr key={t.id}>
                      <Td>
                        <span className={"block font-medium " + (inactive ? "text-muted-foreground" : "text-foreground")}>{t.displayName || t.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {t.displayName ? `${t.name} · ` : ""}
                          {t.origin === "connector" ? "from the connector" : "added by hand"}
                        </span>
                        {t.description ? <span className="block max-w-md truncate text-xs text-muted-foreground">{t.description}</span> : null}
                      </Td>
                      <Td>{MODE_LABEL[t.requestMode]}</Td>
                      <Td hideBelow="lg">
                        {t.defaultDurationDays || t.maxDurationDays ? (
                          <span className="tabular-nums">
                            {t.defaultDurationDays ? `${t.defaultDurationDays} days by default` : ""}
                            {t.defaultDurationDays && t.maxDurationDays ? " · " : ""}
                            {t.maxDurationDays ? `at most ${t.maxDurationDays}` : ""}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">No limit</span>
                        )}
                      </Td>
                      <Td hideBelow="lg">{t.certifiable ? "Yes" : "No"}</Td>
                      <Td className="tabular-nums">{t.entitlementCount ?? 0}</Td>
                      <Td>
                        <Badge tone={inactive ? "neutral" : "success"}>{inactive ? "Disabled" : "Active"}</Badge>
                      </Td>
                      {canManage ? (
                        <Td className="text-right">
                          <RowMenu
                            label={`Actions for type ${t.name}`}
                            items={[
                              { label: "Edit…", onSelect: () => setDialog({ kind: "type", type: t }) },
                              { label: inactive ? "Enable" : "Disable", onSelect: () => toggle(t.id, url, inactive ? "active" : "inactive") },
                              { label: "Delete…", danger: true, onSelect: () => setDialog({ kind: "delete", what: `The type “${t.name}”`, url, id: t.id }) },
                            ]}
                          />
                        </Td>
                      ) : null}
                    </Tr>
                  );
                })}
              </tbody>
            </TableContainer>
          )}
        </CardBody>
      </Card>

      <Modal title={dialog?.kind === "entitlement" ? (dialog.entitlement ? "Edit entitlement" : "Add entitlement") : ""} open={dialog?.kind === "entitlement"} onOpenChange={(o) => !o && close()}>
        {dialog?.kind === "entitlement" ? <EntitlementForm applicationId={applicationId} entitlement={dialog.entitlement} types={activeTypes} onDone={close} /> : null}
      </Modal>
      <Modal title={dialog?.kind === "type" ? (dialog.type ? "Edit entitlement type" : "Add entitlement type") : ""} open={dialog?.kind === "type"} onOpenChange={(o) => !o && close()}>
        {dialog?.kind === "type" ? <TypeForm applicationId={applicationId} type={dialog.type} onDone={close} /> : null}
      </Modal>
      <Modal title="Delete" open={dialog?.kind === "delete"} onOpenChange={(o) => !o && close()}>
        {dialog?.kind === "delete" ? (
          <ConfirmDelete what={dialog.what} url={dialog.url} onDone={close} onDeleted={() => setRemoved((r) => new Set(r).add(dialog.id))} />
        ) : null}
      </Modal>
    </div>
  );
}
