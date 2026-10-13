"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/tenant/session";
import { renameMyOrganization, setMyOrganizationDisabled } from "@/lib/tenant/manage";
import { urlForTenant } from "@/lib/tenant/hostTenant";
import { orderEnvironment } from "@/modules/billing/environmentOrders";
import { ApiError } from "@/lib/shared/types/foundation";

/**
 * Owner request (2026-10-13): "Manage organizations". Each action runs as
 * the signed-in person; the database decides whether they own the
 * organization (migration 0161). Results are reported as they are: a
 * refusal or failure is never shown as done (§17.5).
 */
export type ManageState = { ok: boolean; error: string | null; message?: string };

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError && err.status < 500 ? err.message : err instanceof ApiError && err.message ? err.message : fallback;
}

export async function renameOrganizationAction(tenantId: string, _prev: ManageState, formData: FormData): Promise<ManageState> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Sign in again." };
  const name = String(formData.get("name") ?? "");
  try {
    await renameMyOrganization(user.id, tenantId, name);
  } catch (err) {
    return { ok: false, error: message(err, "The organization could not be renamed.") };
  }
  revalidatePath("/", "layout");
  return { ok: true, error: null, message: "Renamed." };
}

export async function setOrganizationDisabledAction(tenantId: string, disabled: boolean): Promise<ManageState> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Sign in again." };
  try {
    const changed = await setMyOrganizationDisabled(user.id, tenantId, disabled);
    if (changed === 0) return { ok: false, error: disabled ? "It is already disabled." : "It is already enabled." };
  } catch (err) {
    return { ok: false, error: message(err, disabled ? "It could not be disabled." : "It could not be enabled.") };
  }
  revalidatePath("/", "layout");
  return { ok: true, error: null };
}

export async function orderEnvironmentAction(organizationId: string, _prev: ManageState, formData: FormData): Promise<ManageState> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Sign in again." };
  const environment = String(formData.get("environment") ?? "");
  const priceId = String(formData.get("priceId") ?? "");
  try {
    const { slug } = await orderEnvironment(user.id, organizationId, environment, priceId);
    const url = slug ? await urlForTenant(slug) : null;
    revalidatePath("/", "layout");
    return { ok: true, error: null, message: url ? `Ready at ${url.replace(/^https?:\/\//, "")}` : "The environment is ready." };
  } catch (err) {
    return { ok: false, error: message(err, "The environment could not be set up.") };
  }
}
