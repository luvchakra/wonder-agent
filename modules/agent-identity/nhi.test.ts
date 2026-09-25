// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/supabaseServer", () => ({ supabaseServer: vi.fn() }));
vi.mock("@/modules/integrations/service", () => ({ listIntegrations: vi.fn() }));
vi.mock("./discovery", () => ({ buildDiscoveryInbox: vi.fn() }));

import { inventoryFromSources } from "./nhi";
import type { DiscoveryInboxEntry } from "@/lib/shared/types/agent-identity";

const linkedRow = (over: Record<string, unknown>) => ({
  external_reference: "svc-finance",
  source_system: "int-1",
  identity_type: "service_account" as const,
  status: "active",
  created_at: "2026-09-01T00:00:00Z",
  agent_id: "a1",
  agents: { id: "a1", agent_name: "FinanceBot", lifecycle_state: "ACTIVE" },
  ...over,
});

const inboxEntry = (over: Partial<DiscoveryInboxEntry>): DiscoveryInboxEntry => ({
  externalId: "svc-backup",
  integrationId: "int-1",
  integrationName: "Saviynt",
  sourceSystem: "int-1",
  displayName: "Backup job",
  identityType: "service_account",
  owner: "ops@example.com",
  application: null,
  category: "new",
  classification: "NON_AGENT",
  confidenceScore: 0,
  confidenceLevel: "LOW",
  signals: [],
  changeType: "NEW",
  candidateStatus: "open",
  lastSeenAt: "2026-09-20T00:00:00Z",
  raw: {},
  ...over,
});

describe("inventoryFromSources (IDENTITY-P0-11)", () => {
  const names = new Map([["int-1", "Saviynt"]]);

  it("lists linked identities with their agent and unlinked ones with their classification, never assuming an NHI is an agent", () => {
    const rows = inventoryFromSources([linkedRow({})], [inboxEntry({})], names);
    expect(rows).toHaveLength(2);
    const linked = rows.find((r) => r.status === "linked")!;
    expect(linked).toMatchObject({ agent: { id: "a1", name: "FinanceBot" }, sourceName: "Saviynt", classification: null, href: "/agents/a1" });
    const unlinked = rows.find((r) => r.status === "unlinked")!;
    expect(unlinked).toMatchObject({ agent: null, classification: "NON_AGENT", owner: "ops@example.com", href: "/agents/discovery/int-1/svc-backup" });
  });

  it("marks a link whose agent is retired or gone as orphaned, and skips the inbox's duplicate orphan entry", () => {
    const rows = inventoryFromSources(
      [linkedRow({ agents: { id: "a1", agent_name: "Old", lifecycle_state: "RETIRED" } }), linkedRow({ external_reference: "svc-x", agents: null })],
      [inboxEntry({ category: "orphaned_identity", externalId: "svc-finance" })],
      names,
    );
    expect(rows.map((r) => r.status)).toEqual(["orphaned", "orphaned"]);
  });

  it("excludes human delegates and removed links, and reflects an ignore decision", () => {
    const rows = inventoryFromSources(
      [linkedRow({ identity_type: "human_delegate" }), linkedRow({ external_reference: "gone", status: "removed" })],
      [inboxEntry({ identityType: "human_delegate" }), inboxEntry({ externalId: "svc-ignored", candidateStatus: "ignored" })],
      names,
    );
    expect(rows.map((r) => [r.externalReference, r.status])).toEqual([["svc-ignored", "ignored"]]);
  });

  it("includes shadow AI references as unlinked identities from runtime telemetry", () => {
    const rows = inventoryFromSources([], [inboxEntry({ category: "shadow_ai", integrationId: "runtime", sourceSystem: "runtime", integrationName: "Runtime telemetry", externalId: "bot-7", displayName: "bot-7", identityType: "workload_identity", classification: "CONFIRMED_AGENT" })], names);
    expect(rows[0]).toMatchObject({ status: "unlinked", sourceName: "Runtime telemetry", classification: "CONFIRMED_AGENT" });
  });
});
