"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { rotateReceiverSecret } from "@/modules/integrations/framework/receive";
import {
  connectSystem,
  previewConnector,
  saveCustomDefinition,
  setConnectorCredentials,
  updateConnectorSettings,
  type DefinitionOrigin,
  type PreviewResult,
} from "@/modules/integrations/framework/catalog";
import { connectionTypeHref } from "@/modules/integrations/framework/typeSummary";

/**
 * Connection type and connection forms. Each returns the real outcome (§17.5): a
 * connection whose credential test failed says so instead of claiming
 * success. Secret values are read from the form and passed straight to the
 * catalog service, which tests and encrypts them; they are never returned.
 */
export type ConnectorFormState = { status: "idle" } | { status: "saved"; message: string } | { status: "error"; message: string };

function formError(err: unknown): ConnectorFormState {
  if (err instanceof ApiError) return { status: "error", message: err.message || err.code };
  if (err instanceof SyntaxError) return { status: "error", message: "That is not valid JSON" };
  return { status: "error", message: "Something went wrong" };
}

/** Form fields named `setting.<key>` and `secret.<key>`, as objects. */
function prefixed(formData: FormData, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (k.startsWith(prefix) && typeof v === "string" && v !== "") out[k.slice(prefix.length)] = v;
  return out;
}

export async function connectSystemAction(origin: DefinitionOrigin, key: string, _prev: ConnectorFormState, formData: FormData): Promise<ConnectorFormState> {
  const ctx = await requirePermission("integration.create");
  let target: string;
  try {
    const secret = prefixed(formData, "secret.");
    const { integration, credentialError } = await connectSystem(ctx.tenantId!, ctx.userId, {
      origin,
      key,
      version: String(formData.get("version") ?? "") || undefined,
      name: String(formData.get("name") ?? ""),
      settings: prefixed(formData, "setting."),
      secret: Object.keys(secret).length ? secret : undefined,
    });
    target = `/integrations/${integration.id}${credentialError ? "?credentials=failed" : ""}`;
  } catch (err) {
    return formError(err);
  }
  revalidatePath("/integrations");
  redirect(target);
}

export async function updateConnectorSettingsAction(integrationId: string, _prev: ConnectorFormState, formData: FormData): Promise<ConnectorFormState> {
  const ctx = await requirePermission("integration.update");
  try {
    await updateConnectorSettings(ctx.tenantId!, ctx.userId, integrationId, { name: formData.get("name"), settings: prefixed(formData, "setting.") });
  } catch (err) {
    return formError(err);
  }
  revalidatePath(`/integrations/${integrationId}`);
  revalidatePath("/integrations");
  return { status: "saved", message: "Settings saved." };
}

export async function setConnectorCredentialsAction(integrationId: string, _prev: ConnectorFormState, formData: FormData): Promise<ConnectorFormState> {
  const ctx = await requirePermission("integration.update");
  try {
    await setConnectorCredentials(ctx.tenantId!, ctx.userId, integrationId, prefixed(formData, "secret."));
  } catch (err) {
    return formError(err);
  }
  revalidatePath(`/integrations/${integrationId}`);
  return { status: "saved", message: "Connection tested and credentials saved. A field left empty kept its saved value." };
}

export async function publishDefinitionAction(_prev: ConnectorFormState, formData: FormData): Promise<ConnectorFormState> {
  const ctx = await requirePermission("integration.create");
  let key: string;
  try {
    ({ key } = await saveCustomDefinition(ctx.tenantId!, ctx.userId, JSON.parse(String(formData.get("definition") ?? ""))));
  } catch (err) {
    return formError(err);
  }
  revalidatePath("/integrations/types");
  redirect(connectionTypeHref("custom", key));
}

export type PreviewState = { status: "idle" } | { status: "error"; message: string } | { status: "done"; result: PreviewResult };

export async function previewDefinitionAction(_prev: PreviewState, formData: FormData): Promise<PreviewState> {
  const ctx = await requirePermission("integration.create");
  try {
    const result = await previewConnector(ctx.tenantId!, ctx.userId, {
      manifest: JSON.parse(String(formData.get("definition") ?? "")),
      settings: JSON.parse(String(formData.get("settings") || "{}")),
      secret: JSON.parse(String(formData.get("secret") || "{}")),
      resource: String(formData.get("resource") ?? ""),
    });
    return { status: "done", result };
  } catch (err) {
    const e = formError(err);
    return { status: "error", message: e.status === "error" ? e.message : "Something went wrong" };
  }
}

export type ReceiverSecretState = { status: "idle" } | { status: "issued"; secret: string } | { status: "error"; message: string };

/** Issues or replaces a connection's receiving secret; it is shown once, in this response only. */
export async function rotateReceiverSecretAction(integrationId: string, _prev: ReceiverSecretState): Promise<ReceiverSecretState> {
  const ctx = await requirePermission("integration.update");
  try {
    const secret = await rotateReceiverSecret(ctx.tenantId!, ctx.userId, integrationId);
    revalidatePath(`/integrations/${integrationId}`);
    return { status: "issued", secret };
  } catch (err) {
    const e = formError(err);
    return { status: "error", message: e.status === "error" ? e.message : "Something went wrong" };
  }
}
