/**
 * Shared contracts owned by the Platform Agent
 * (docs/plan/09-PLATFORM-AGENT-BACKLOG.md). Other modules import these
 * instead of redefining platform-admin shapes, and must check feature
 * flags only through modules/platform-admin/service.ts's
 * `isFeatureEnabled()` — never by querying platform_tenants/subscriptions/
 * feature_flags directly.
 */

export type TenantEnvironment = "production" | "sandbox";

export type PlatformTenant = {
  tenantId: string;
  environment: TenantEnvironment;
  notes: string | null;
  createdAt: string;
  // Denormalized for convenience (joined at read time, never persisted here):
  name?: string;
  slug?: string;
  status?: "active" | "suspended" | "deprovisioned";
};

export type SubscriptionPlan = "free" | "pro" | "max" | "enterprise";
export type SubscriptionStatus = "active" | "past_due" | "cancelled" | "trialing" | "incomplete" | "paused";

export type Subscription = {
  id: string;
  tenantId: string;
  plan: SubscriptionPlan;
  maxUsers: number;
  maxAgents: number;
  maxIntegrations: number;
  maxRuntimeEventsPerMonth: number;
  auditRetentionDays: number;
  status: SubscriptionStatus;
  startedAt: string;
  renewedAt: string | null;
  // PLATFORM-P1-04 (0102) — billing provider link. "manual" is the
  // platform-assigned path that predates billing.
  provider?: BillingProviderOrManual;
  priceId?: string | null;
  billingInterval?: BillingInterval | null;
  currency?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
};

// ---------------------------------------------------------------------------
// PLATFORM-P1-04 — Billing (Stripe + Razorpay), migration 0102.
// ---------------------------------------------------------------------------

export type BillingProvider = "stripe" | "razorpay";
export type BillingProviderOrManual = BillingProvider | "manual";
export type BillingInterval = "month" | "year";
export type PaidPlan = "pro" | "max";

export type BillingPrice = {
  id: string;
  plan: PaidPlan;
  interval: BillingInterval;
  currency: string;
  unitAmount: number;
  taxBehavior: "inclusive" | "exclusive";
  active: boolean;
};

export type TaxIdType = "in_gst" | "eu_vat" | "gb_vat" | "au_abn" | "us_ein" | "other";

export type BillingProfile = {
  tenantId: string;
  legalName: string;
  billingEmail: string;
  country: string;
  region: string | null;
  city: string | null;
  postalCode: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  taxIdType: TaxIdType | null;
  taxId: string | null;
  updatedAt: string;
};

export type InvoiceStatus = "open" | "paid" | "void" | "uncollectible" | "refunded" | "partially_refunded";

export type TaxLine = { name: string; rate: number; amount: number };

export type BillingInvoice = {
  id: string;
  tenantId: string;
  provider: BillingProvider;
  invoiceNumber: string | null;
  providerNumber: string | null;
  status: InvoiceStatus;
  currency: string;
  subtotal: number;
  taxAmount: number;
  total: number;
  amountPaid: number;
  amountRefunded: number;
  taxBreakdown: TaxLine[];
  periodStart: string | null;
  periodEnd: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
  issuedAt: string;
  paidAt: string | null;
};

export type BillingAdjustmentKind = "refund" | "plan_override" | "cancel_immediately";
export type BillingAdjustmentStatus = "pending" | "approved" | "rejected" | "executed" | "failed";

export type BillingAdjustment = {
  id: string;
  tenantId: string;
  invoiceId: string | null;
  kind: BillingAdjustmentKind;
  amount: number | null;
  currency: string | null;
  targetPlan: SubscriptionPlan | null;
  reason: string;
  status: BillingAdjustmentStatus;
  requestedBy: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  executedAt: string | null;
  providerReference: string | null;
  error: string | null;
};

export type BillingWebhookEvent = {
  id: string;
  provider: BillingProvider;
  eventId: string;
  eventType: string;
  tenantId: string | null;
  signatureVerified: boolean;
  status: "received" | "processed" | "ignored" | "failed";
  attempts: number;
  error: string | null;
  receivedAt: string;
  processedAt: string | null;
};

export type FeatureFlag = {
  key: string;
  displayName: string;
  description: string | null;
  defaultEnabled: boolean;
};

export type TenantFeatureFlag = {
  tenantId: string;
  flagKey: string;
  enabled: boolean;
  updatedAt: string;
};

export type PlatformBranding = {
  productName: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  supportUrl: string | null;
  docsUrl: string | null;
  defaultEmailSender: string | null;
  defaultTheme: "light" | "dark" | "system";
  updatedAt: string;
};

// PLATFORM-P0-05.2 — AI Provider Configuration (resolved 2026-09-16: OpenAI,
// platform-wide default + per-tenant BYOK, tenant chooses via useOwnKey).
// Gemini added 2026-09-16 as a second supported provider, same model.
export type AiProviderName = "openai" | "gemini";

export type AiProviderConfig = {
  tenantId: string;
  provider: AiProviderName;
  useOwnKey: boolean;
  /** Whether a BYOK key is currently stored — never the key itself. */
  hasOwnKey: boolean;
  model: string;
  updatedBy: string;
  updatedAt: string;
  createdAt: string;
};

/** Server-only — never returned from an API route or rendered to a client. */
export type ResolvedAiProviderKey = {
  source: "byok" | "platform";
  provider: AiProviderName;
  apiKey: string;
  model: string;
};

export type PlatformHealthSignal = {
  name: string;
  status: "ok" | "degraded" | "not_instrumented";
  detail?: string;
};

export type PlatformHealth = {
  signals: PlatformHealthSignal[];
  checkedAt: string;
};
