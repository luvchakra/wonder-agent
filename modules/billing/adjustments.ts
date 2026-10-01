import "server-only";

import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { writeAudit } from "@/lib/audit/writeAudit";
import { ApiError } from "@/lib/shared/types/foundation";
import { safeErrorMessage } from "@/lib/security/redact";
import type { BillingAdjustment, BillingAdjustmentKind, BillingPrice, BillingWebhookEvent, SubscriptionPlan } from "@/lib/shared/types/platform";
import { PLAN_DEFAULTS } from "@/modules/platform-admin/service";
import { writePlatformAudit } from "@/modules/platform-admin/auditLog";
import { toAdjustment, toInvoice, toPrice, toWebhookEvent } from "./mappers";
import * as stripe from "./stripeClient";
import * as razorpay from "./razorpayClient";

/**
 * PLATFORM-P1-04 — the vendor side of billing, reachable only behind
 * requirePlatformAdmin() (non-negotiable #3). Refunds, plan overrides and
 * immediate cancellations are maker-checker (SOX segregation of duties,
 * non-negotiable #15): one platform administrator requests with a reason,
 * a DIFFERENT one approves (enforced here and by the
 * billing_adjustments_four_eyes check constraint), and only then does it
 * execute against the provider. Every step is in platform_audit_logs, and
 * the outcome also in the tenant's own audit trail.
 */

const db = () => supabaseServiceRole();

export async function listAdjustments(opts: { tenantId?: string; status?: string } = {}): Promise<BillingAdjustment[]> {
  let q = db().from("billing_adjustments").select().order("requested_at", { ascending: false }).limit(200);
  if (opts.tenantId) q = q.eq("tenant_id", opts.tenantId);
  if (opts.status) q = q.eq("status", opts.status);
  const { data, error } = await q;
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toAdjustment);
}

export async function listTenantInvoicesForPlatform(tenantId: string) {
  const { data, error } = await db().from("billing_invoices").select().eq("tenant_id", tenantId).order("issued_at", { ascending: false }).limit(100);
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toInvoice);
}

export async function listWebhookEvents(opts: { tenantId?: string; status?: string; limit?: number } = {}): Promise<BillingWebhookEvent[]> {
  let q = db().from("billing_webhook_events").select("id, provider, event_id, event_type, tenant_id, signature_verified, status, attempts, error, received_at, processed_at").order("received_at", { ascending: false }).limit(Math.min(opts.limit ?? 100, 200));
  if (opts.tenantId) q = q.eq("tenant_id", opts.tenantId);
  if (opts.status) q = q.eq("status", opts.status);
  const { data, error } = await q;
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map(toWebhookEvent);
}

export type AdjustmentRequest = { tenantId: string; kind: BillingAdjustmentKind; invoiceId?: string | null; amount?: number | null; targetPlan?: SubscriptionPlan | null; reason: string };

export async function requestAdjustment(actorId: string, input: AdjustmentRequest): Promise<BillingAdjustment> {
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 10) throw new ApiError(400, "VALIDATION_FAILED", "Give a reason of at least 10 characters");
  const supabase = db();
  let currency: string | null = null;
  if (input.kind === "refund") {
    if (!input.invoiceId) throw new ApiError(400, "VALIDATION_FAILED", "Choose the invoice to refund");
    if (!input.amount || !Number.isInteger(input.amount) || input.amount <= 0) throw new ApiError(400, "VALIDATION_FAILED", "Enter a refund amount in minor units");
    const { data: inv } = await supabase.from("billing_invoices").select().eq("id", input.invoiceId).eq("tenant_id", input.tenantId).maybeSingle();
    if (!inv) throw new ApiError(404, "INVOICE_NOT_FOUND", "That invoice is not this tenant's");
    if (input.amount > Number(inv.amount_paid) - Number(inv.amount_refunded)) throw new ApiError(400, "VALIDATION_FAILED", "The refund exceeds what remains refundable on the invoice");
    currency = inv.currency;
  }
  if (input.kind === "plan_override" && !input.targetPlan) throw new ApiError(400, "VALIDATION_FAILED", "Choose the plan to apply");

  const { data, error } = await supabase
    .from("billing_adjustments")
    .insert({
      tenant_id: input.tenantId,
      kind: input.kind,
      invoice_id: input.kind === "refund" ? input.invoiceId : null,
      amount: input.kind === "refund" ? input.amount : null,
      currency,
      target_plan: input.kind === "plan_override" ? input.targetPlan : null,
      reason,
      requested_by: actorId,
    })
    .select()
    .single();
  if (error || !data) throw new ApiError(500, "CREATE_FAILED", error?.message ?? "Failed to request the adjustment");
  await writePlatformAudit({ actorId, tenantId: input.tenantId, action: "platform.billing_adjustment_requested", newValue: { id: data.id, kind: input.kind, amount: input.amount ?? null, targetPlan: input.targetPlan ?? null }, result: "success" });
  return toAdjustment(data);
}

export async function decideAdjustment(actorId: string, adjustmentId: string, approve: boolean, note: string | null): Promise<BillingAdjustment> {
  const supabase = db();
  const { data: adj } = await supabase.from("billing_adjustments").select().eq("id", adjustmentId).maybeSingle();
  if (!adj) throw new ApiError(404, "NOT_FOUND", "No such adjustment");
  if (adj.status !== "pending") throw new ApiError(409, "ALREADY_DECIDED", "This adjustment has already been decided");
  if (adj.requested_by === actorId) {
    await writePlatformAudit({ actorId, tenantId: adj.tenant_id, action: "platform.billing_adjustment_self_approval_refused", newValue: { id: adjustmentId }, result: "failure" });
    throw new ApiError(403, "FOUR_EYES_REQUIRED", "A different platform administrator must approve this request");
  }
  const decidedAt = new Date().toISOString();
  const { data: decided, error } = await supabase
    .from("billing_adjustments")
    .update({ status: approve ? "approved" : "rejected", decided_by: actorId, decided_at: decidedAt, decision_note: note?.trim() || null })
    .eq("id", adjustmentId)
    .eq("status", "pending")
    .select()
    .maybeSingle();
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  if (!decided) throw new ApiError(409, "ALREADY_DECIDED", "This adjustment has already been decided");
  await writePlatformAudit({ actorId, tenantId: adj.tenant_id, action: approve ? "platform.billing_adjustment_approved" : "platform.billing_adjustment_rejected", newValue: { id: adjustmentId }, result: "success" });
  if (!approve) return toAdjustment(decided);
  return executeAdjustment(actorId, toAdjustment(decided));
}

async function executeAdjustment(actorId: string, adj: BillingAdjustment): Promise<BillingAdjustment> {
  const supabase = db();
  let providerReference: string | null = null;
  try {
    if (adj.kind === "refund") {
      const { data: inv } = await supabase.from("billing_invoices").select().eq("id", adj.invoiceId!).eq("tenant_id", adj.tenantId).single();
      if (!inv?.provider_payment_id) throw new Error("The invoice has no recorded payment to refund");
      if (inv.provider === "stripe") {
        providerReference = (await stripe.createRefund({ paymentIntentOrCharge: inv.provider_payment_id, amount: adj.amount!, reason: adj.reason }, `wid-refund-${adj.id}`)).id;
      } else {
        providerReference = (await razorpay.createRefund({ paymentId: inv.provider_payment_id, amount: adj.amount!, receipt: adj.id.replace(/-/g, "").slice(0, 32), reason: adj.reason })).id;
      }
      // The provider's refund webhook records the refunded amount on the invoice.
    } else if (adj.kind === "cancel_immediately") {
      const { data: sub } = await supabase.from("subscriptions").select().eq("tenant_id", adj.tenantId).neq("provider", "manual").order("started_at", { ascending: false }).limit(1).maybeSingle();
      if (!sub?.provider_subscription_id) throw new Error("There is no provider subscription to cancel");
      if (sub.provider === "stripe") providerReference = (await stripe.cancelImmediately(sub.provider_subscription_id)).id;
      else providerReference = (await razorpay.cancelSubscription(sub.provider_subscription_id, false)).id;
    } else {
      const plan = adj.targetPlan!;
      const limits = PLAN_DEFAULTS[plan];
      const { data: sub } = await supabase.from("subscriptions").select("id").eq("tenant_id", adj.tenantId).order("started_at", { ascending: false }).limit(1).maybeSingle();
      const row = {
        plan,
        max_users: limits.maxUsers,
        max_agents: limits.maxAgents,
        max_integrations: limits.maxIntegrations,
        max_runtime_events_per_month: limits.maxRuntimeEventsPerMonth,
        audit_retention_days: limits.auditRetentionDays,
        updated_at: new Date().toISOString(),
      };
      const { error } = sub
        ? await supabase.from("subscriptions").update(row).eq("id", sub.id).eq("tenant_id", adj.tenantId)
        : await supabase.from("subscriptions").insert({ ...row, tenant_id: adj.tenantId, status: "active", provider: "manual" });
      if (error) throw new Error(error.message);
      providerReference = sub?.id ?? null;
    }
    const { data } = await supabase.from("billing_adjustments").update({ status: "executed", executed_at: new Date().toISOString(), provider_reference: providerReference }).eq("id", adj.id).select().single();
    await writePlatformAudit({ actorId, tenantId: adj.tenantId, action: "platform.billing_adjustment_executed", newValue: { id: adj.id, kind: adj.kind, providerReference }, result: "success" });
    await writeAudit({
      tenantId: adj.tenantId,
      actorId: null,
      actorType: "system",
      action: `billing.adjustment_${adj.kind}`,
      objectType: "billing_adjustment",
      objectId: adj.id,
      outcome: "success",
      metadata: { amount: adj.amount, currency: adj.currency, targetPlan: adj.targetPlan, approvedBy: "platform" },
    });
    return toAdjustment(data);
  } catch (err) {
    const message = safeErrorMessage(err);
    const { data } = await supabase.from("billing_adjustments").update({ status: "failed", error: message }).eq("id", adj.id).select().single();
    await writePlatformAudit({ actorId, tenantId: adj.tenantId, action: "platform.billing_adjustment_failed", newValue: { id: adj.id, error: message }, result: "failure" });
    return toAdjustment(data);
  }
}

export async function listAllPrices(): Promise<(BillingPrice & { stripeLinked: boolean; razorpayLinked: boolean })[]> {
  const { data, error } = await db().from("billing_prices").select().order("plan").order("billing_interval").order("currency");
  if (error) throw new ApiError(500, "QUERY_FAILED", error.message);
  return (data ?? []).map((r) => ({ ...toPrice(r), stripeLinked: !!r.stripe_price_id, razorpayLinked: !!r.razorpay_plan_id }));
}

/** Provider prices are immutable, so a new amount unlinks them; the next checkout creates new ones. */
export async function updatePrice(actorId: string, priceId: string, input: { unitAmount?: number; active?: boolean }): Promise<void> {
  const supabase = db();
  const { data: prev } = await supabase.from("billing_prices").select().eq("id", priceId).maybeSingle();
  if (!prev) throw new ApiError(404, "PRICE_NOT_FOUND");
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.unitAmount !== undefined) {
    if (!Number.isInteger(input.unitAmount) || input.unitAmount <= 0) throw new ApiError(400, "VALIDATION_FAILED", "Enter a positive amount in minor units");
    if (input.unitAmount !== Number(prev.unit_amount)) Object.assign(patch, { unit_amount: input.unitAmount, stripe_price_id: null, razorpay_plan_id: null });
  }
  if (input.active !== undefined) patch.active = input.active;
  const { error } = await supabase.from("billing_prices").update(patch).eq("id", priceId);
  if (error) throw new ApiError(500, "UPDATE_FAILED", error.message);
  await writePlatformAudit({ actorId, action: "platform.billing_price_updated", oldValue: { unitAmount: Number(prev.unit_amount), active: prev.active }, newValue: { unitAmount: input.unitAmount ?? Number(prev.unit_amount), active: input.active ?? prev.active, priceId }, result: "success" });
}
