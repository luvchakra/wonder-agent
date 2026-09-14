import "server-only";

import type { PlatformBranding, PlatformTenant, Subscription, FeatureFlag } from "@/lib/shared/types/platform";

/* eslint-disable @typescript-eslint/no-explicit-any -- mapping raw Supabase rows */

export function toPlatformTenant(row: any): PlatformTenant {
  return {
    tenantId: row.tenant_id,
    environment: row.environment,
    notes: row.notes,
    createdAt: row.created_at,
    name: row.tenants?.name,
    slug: row.tenants?.slug,
    status: row.tenants?.status,
  };
}

export function toSubscription(row: any): Subscription {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    plan: row.plan,
    maxUsers: row.max_users,
    maxAgents: row.max_agents,
    maxIntegrations: row.max_integrations,
    maxRuntimeEventsPerMonth: Number(row.max_runtime_events_per_month),
    auditRetentionDays: row.audit_retention_days,
    status: row.status,
    startedAt: row.started_at,
    renewedAt: row.renewed_at,
  };
}

export function toFeatureFlag(row: any): FeatureFlag {
  return {
    key: row.key,
    displayName: row.display_name,
    description: row.description,
    defaultEnabled: row.default_enabled,
  };
}

export function toPlatformBranding(row: any): PlatformBranding {
  return {
    productName: row.product_name,
    logoUrl: row.logo_url,
    faviconUrl: row.favicon_url,
    supportUrl: row.support_url,
    docsUrl: row.docs_url,
    defaultEmailSender: row.default_email_sender,
    defaultTheme: row.default_theme,
    updatedAt: row.updated_at,
  };
}
