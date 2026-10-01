"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/rbac/requirePlatformAdmin";
import { decideAdjustment, requestAdjustment, updatePrice } from "@/modules/billing/adjustments";
import type { BillingAdjustmentKind, SubscriptionPlan } from "@/lib/shared/types/platform";

/**
 * PLATFORM-P1-04 — the vendor billing console's actions, behind
 * requirePlatformAdmin(). Requesting and approving an adjustment are
 * separate actions by separate administrators (the service refuses
 * self-approval; the database refuses it again).
 */

export async function requestAdjustmentAction(formData: FormData) {
  const { userId } = await requirePlatformAdmin();
  const amountRaw = String(formData.get("amount") ?? "").trim();
  await requestAdjustment(userId, {
    tenantId: String(formData.get("tenantId") ?? ""),
    kind: String(formData.get("kind") ?? "") as BillingAdjustmentKind,
    invoiceId: String(formData.get("invoiceId") ?? "") || null,
    amount: amountRaw ? Math.round(Number(amountRaw) * 100) : null,
    targetPlan: (String(formData.get("targetPlan") ?? "") || null) as SubscriptionPlan | null,
    reason: String(formData.get("reason") ?? ""),
  });
  revalidatePath("/platform-admin/billing");
}

export async function decideAdjustmentAction(adjustmentId: string, approve: boolean, formData: FormData) {
  const { userId } = await requirePlatformAdmin();
  await decideAdjustment(userId, adjustmentId, approve, String(formData.get("note") ?? "") || null);
  revalidatePath("/platform-admin/billing");
}

export async function updatePriceAction(priceId: string, formData: FormData) {
  const { userId } = await requirePlatformAdmin();
  const amount = Number(String(formData.get("amount") ?? ""));
  await updatePrice(userId, priceId, {
    unitAmount: Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : undefined,
    active: formData.get("active") === "on",
  });
  revalidatePath("/platform-admin/billing");
}
