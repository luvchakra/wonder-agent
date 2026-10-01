import type { BillingAdjustment, BillingInvoice, BillingPrice, BillingProfile, BillingWebhookEvent } from "@/lib/shared/types/platform";

/* eslint-disable @typescript-eslint/no-explicit-any -- mapping raw Supabase rows */

export function toPrice(row: any): BillingPrice {
  return {
    id: row.id,
    plan: row.plan,
    interval: row.billing_interval,
    currency: row.currency,
    unitAmount: Number(row.unit_amount),
    taxBehavior: row.tax_behavior,
    active: row.active,
  };
}

export function toProfile(row: any): BillingProfile {
  return {
    tenantId: row.tenant_id,
    legalName: row.legal_name,
    billingEmail: row.billing_email,
    country: row.country,
    region: row.region,
    city: row.city,
    postalCode: row.postal_code,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    taxIdType: row.tax_id_type,
    taxId: row.tax_id,
    updatedAt: row.updated_at,
  };
}

export function toInvoice(row: any): BillingInvoice {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    provider: row.provider,
    invoiceNumber: row.invoice_number,
    providerNumber: row.provider_number,
    status: row.status,
    currency: row.currency,
    subtotal: Number(row.subtotal),
    taxAmount: Number(row.tax_amount),
    total: Number(row.total),
    amountPaid: Number(row.amount_paid),
    amountRefunded: Number(row.amount_refunded),
    taxBreakdown: Array.isArray(row.tax_breakdown) ? row.tax_breakdown : [],
    periodStart: row.period_start,
    periodEnd: row.period_end,
    hostedInvoiceUrl: row.hosted_invoice_url,
    invoicePdfUrl: row.invoice_pdf_url,
    issuedAt: row.issued_at,
    paidAt: row.paid_at,
  };
}

export function toAdjustment(row: any): BillingAdjustment {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    invoiceId: row.invoice_id,
    kind: row.kind,
    amount: row.amount === null ? null : Number(row.amount),
    currency: row.currency,
    targetPlan: row.target_plan,
    reason: row.reason,
    status: row.status,
    requestedBy: row.requested_by,
    requestedAt: row.requested_at,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    decisionNote: row.decision_note,
    executedAt: row.executed_at,
    providerReference: row.provider_reference,
    error: row.error,
  };
}

export function toWebhookEvent(row: any): BillingWebhookEvent {
  return {
    id: row.id,
    provider: row.provider,
    eventId: row.event_id,
    eventType: row.event_type,
    tenantId: row.tenant_id,
    signatureVerified: row.signature_verified,
    status: row.status,
    attempts: row.attempts,
    error: row.error,
    receivedAt: row.received_at,
    processedAt: row.processed_at,
  };
}
