"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { cancelSubscriptionAtPeriodEnd, openBillingPortal, resumeSubscription, saveBillingProfile, startCheckout } from "@/modules/billing/service";

/**
 * PLATFORM-P1-04 — the Billing screen's server actions. Tenant and actor
 * come from the session; each checks billing.manage. Checkout and the
 * portal end in a redirect to the provider's hosted page, so no card or
 * bank detail is ever entered on WonderID. Results are reported as the
 * server gave them (§17.5): a cancellation reads "scheduled", never "done".
 */

export type BillingActionState = { ok: boolean; message: string | null; errors?: Record<string, string> };

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3100";
  const proto = h.get("x-forwarded-proto") ?? (process.env.NODE_ENV === "production" ? "https" : "http");
  return `${proto}://${host}`;
}

function refused(err: unknown): BillingActionState {
  if (err instanceof ApiError) return { ok: false, message: err.message };
  throw err;
}

export async function saveBillingProfileAction(_prev: BillingActionState, formData: FormData): Promise<BillingActionState> {
  const raw: Record<string, unknown> = {};
  for (const key of ["legalName", "billingEmail", "country", "region", "city", "postalCode", "addressLine1", "addressLine2", "taxIdType", "taxId"]) {
    raw[key] = formData.get(key);
  }
  try {
    const ctx = await requirePermission("billing.manage");
    const result = await saveBillingProfile(ctx.tenantId!, ctx.userId, raw);
    if (!result.ok) return { ok: false, message: "Check the highlighted fields.", errors: result.errors };
  } catch (err) {
    return refused(err);
  }
  revalidatePath("/settings/billing");
  return { ok: true, message: "Billing details saved." };
}

export async function startCheckoutAction(_prev: BillingActionState, formData: FormData): Promise<BillingActionState> {
  const priceId = String(formData.get("priceId") ?? "");
  if (!priceId) return { ok: false, message: "Choose a plan." };
  let url: string;
  try {
    const ctx = await requirePermission("billing.manage");
    url = (await startCheckout(ctx.tenantId!, ctx.userId, priceId, await origin())).url;
  } catch (err) {
    return refused(err);
  }
  redirect(url);
}

export async function openPortalAction(): Promise<BillingActionState> {
  let url: string;
  try {
    const ctx = await requirePermission("billing.manage");
    url = await openBillingPortal(ctx.tenantId!, ctx.userId, await origin());
  } catch (err) {
    return refused(err);
  }
  redirect(url);
}

export async function cancelSubscriptionAction(): Promise<BillingActionState> {
  try {
    const ctx = await requirePermission("billing.manage");
    await cancelSubscriptionAtPeriodEnd(ctx.tenantId!, ctx.userId);
  } catch (err) {
    return refused(err);
  }
  revalidatePath("/settings/billing");
  return { ok: true, message: "Cancellation scheduled. The plan stays active until the end of the paid period." };
}

export async function resumeSubscriptionAction(): Promise<BillingActionState> {
  try {
    const ctx = await requirePermission("billing.manage");
    await resumeSubscription(ctx.tenantId!, ctx.userId);
  } catch (err) {
    return refused(err);
  }
  revalidatePath("/settings/billing");
  return { ok: true, message: "The scheduled cancellation was withdrawn." };
}
