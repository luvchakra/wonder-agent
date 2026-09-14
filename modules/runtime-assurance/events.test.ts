// @vitest-environment node
import { describe, expect, it } from "vitest";
import { computeDedupeKey } from "./events";
import type { RuntimeEventInput } from "@/lib/shared/types/runtime";

describe("computeDedupeKey — RUNTIME-P0-01.2", () => {
  const base: RuntimeEventInput = {
    agentId: "facebeef-0000-0000-0000-000000000001",
    eventTime: "2026-09-12T10:31:00Z",
    source: "mcp",
    tool: "query_customer",
    application: "snowflake",
    resource: "customer_db",
    action: "read",
    dataClassification: "PII",
    success: true,
  };

  it("is deterministic for the exact same event payload", () => {
    expect(computeDedupeKey(base)).toBe(computeDedupeKey({ ...base }));
  });

  it("differs when any comparison-relevant field differs", () => {
    const key = computeDedupeKey(base);
    expect(computeDedupeKey({ ...base, action: "write" })).not.toBe(key);
    expect(computeDedupeKey({ ...base, resource: "other_db" })).not.toBe(key);
    expect(computeDedupeKey({ ...base, eventTime: "2026-09-12T10:32:00Z" })).not.toBe(key);
    expect(computeDedupeKey({ ...base, agentId: "deadbeef-0000-0000-0000-000000000002" })).not.toBe(key);
  });

  it("does not collide across a shifted delimiter boundary", () => {
    const a = computeDedupeKey({ ...base, tool: "a", application: "" });
    const b = computeDedupeKey({ ...base, tool: "", application: "a" });
    expect(a).not.toBe(b);
  });
});
