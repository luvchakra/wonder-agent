import "server-only";

import type { AuditLogEntry, Notification, NotificationPreference, SavedReportDefinition } from "@/lib/shared/types/operations";

/* eslint-disable @typescript-eslint/no-explicit-any -- mapping raw Supabase rows */

export function toAuditLogEntry(row: any): AuditLogEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    actorId: row.actor_id,
    actorType: row.actor_type,
    action: row.action,
    objectType: row.object_type,
    objectId: row.object_id,
    outcome: row.outcome,
    metadata: row.metadata ?? {},
    correlationId: row.correlation_id,
    createdAt: row.created_at,
  };
}

export function toNotification(row: any): Notification {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    type: row.type,
    title: row.title,
    body: row.body,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

export function toNotificationPreference(row: any): NotificationPreference {
  return {
    tenantId: row.tenant_id,
    userId: row.user_id,
    type: row.type,
    inAppEnabled: row.in_app_enabled,
    emailEnabled: row.email_enabled,
    updatedAt: row.updated_at,
  };
}

export function toSavedReportDefinition(row: any): SavedReportDefinition {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    reportType: row.report_type,
    name: row.name,
    filters: row.filters ?? {},
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}
