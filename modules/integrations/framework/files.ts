import "server-only";

import { createHash } from "node:crypto";
import { supabaseServiceRole } from "@/lib/db/supabaseServer";
import { ApiError } from "@/lib/shared/types/foundation";
import type { ConnectorFileStore, StoredFile } from "./drivers/file";
import type { DriverContext } from "./engine";
import type { ResourceKind } from "./types";

/**
 * connector_files (migration 0111): the CSV files sent to a file
 * connection's receiver or imported from an object page, kept until a sync
 * has read them (and the newest few after that, for the record).
 *
 * The table has RLS on and no client policy: a file holds an organization's
 * raw data, so only this server code reads it, with the service role, and
 * every query below names the tenant explicitly (§14). The tenant is always
 * the connection row's own, never a request value.
 */

export type ConnectorFileInfo = {
  id: string;
  kind: ResourceKind;
  filename: string | null;
  byteSize: number;
  rowCount: number;
  receivedAt: string;
  readAt: string | null;
};

export async function storeConnectorFile(
  tenantId: string,
  integrationId: string,
  file: { kind: ResourceKind; filename: string | null; content: string; rowCount: number; createdBy: string | null },
): Promise<{ id: string; sha256: string; byteSize: number }> {
  const sha256 = createHash("sha256").update(file.content, "utf8").digest("hex");
  const byteSize = Buffer.byteLength(file.content, "utf8");
  const { data, error } = await supabaseServiceRole()
    .from("connector_files")
    .insert({
      tenant_id: tenantId,
      integration_id: integrationId,
      kind: file.kind,
      filename: file.filename,
      byte_size: byteSize,
      row_count: file.rowCount,
      content: file.content,
      sha256,
      created_by: file.createdBy,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) throw new ApiError(500, "STORE_FAILED", "The file could not be stored");
  return { id: data.id, sha256, byteSize };
}

/** The store a sync's file driver reads uploads from: one connection, its own tenant. */
export function connectorFileStore(context: DriverContext): ConnectorFileStore {
  const { tenantId, integrationId } = context;
  const received = new Map<string, string>();
  return {
    async newest(kind) {
      const { data, error } = await supabaseServiceRole()
        .from("connector_files")
        .select("id, filename, content, received_at")
        .eq("tenant_id", tenantId)
        .eq("integration_id", integrationId)
        .eq("kind", kind)
        .is("consumed_at", null)
        .order("received_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ id: string; filename: string | null; content: string; received_at: string }>();
      if (error) throw new Error("The received files could not be read");
      if (!data) return null;
      received.set(data.id, data.received_at);
      return { id: data.id, filename: data.filename, content: data.content } satisfies StoredFile;
    },
    async markRead(kind, file) {
      const at = received.get(file.id);
      if (!at) return;
      // This file and every older unread file of its kind: a newer file supersedes them.
      const { error } = await supabaseServiceRole()
        .from("connector_files")
        .update({ consumed_at: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .eq("integration_id", integrationId)
        .eq("kind", kind)
        .is("consumed_at", null)
        .lte("received_at", at);
      if (error) console.error("connector file not marked read", { integrationId, fileId: file.id });
    },
  };
}

/** The newest file a connection received, without its content. */
export async function latestConnectorFile(tenantId: string, integrationId: string): Promise<ConnectorFileInfo | null> {
  const { data, error } = await supabaseServiceRole()
    .from("connector_files")
    .select("id, kind, filename, byte_size, row_count, received_at, consumed_at")
    .eq("tenant_id", tenantId)
    .eq("integration_id", integrationId)
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; kind: ResourceKind; filename: string | null; byte_size: number; row_count: number; received_at: string; consumed_at: string | null }>();
  if (error) throw new ApiError(500, "QUERY_FAILED", "The received files could not be read");
  return data
    ? { id: data.id, kind: data.kind, filename: data.filename, byteSize: data.byte_size, rowCount: data.row_count, receivedAt: data.received_at, readAt: data.consumed_at }
    : null;
}

export type FileRetentionRow = { id: string; tenant_id: string; integration_id: string; received_at: string; consumed_at: string | null };

/** Every stored file's metadata (never content), newest first, for the daily retention purge. */
export async function listFilesForRetention(limit = 10_000): Promise<FileRetentionRow[]> {
  const { data, error } = await supabaseServiceRole()
    .from("connector_files")
    .select("id, tenant_id, integration_id, received_at, consumed_at")
    .order("received_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error("connector files could not be listed");
  return (data ?? []) as FileRetentionRow[];
}

/** Deletes these files of one tenant's connection; the tenant filter is part of the delete. */
export async function deleteConnectorFiles(tenantId: string, integrationId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { data, error } = await supabaseServiceRole()
    .from("connector_files")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("integration_id", integrationId)
    .in("id", ids)
    .select("id");
  if (error) throw new Error("connector files could not be purged");
  return (data ?? []).length;
}
