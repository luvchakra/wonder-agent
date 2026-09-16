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
export type SubscriptionStatus = "active" | "past_due" | "cancelled";

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
export type AiProviderName = "openai";

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
