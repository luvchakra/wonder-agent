// @vitest-environment node
import { describe, expect, it } from "vitest";
import { shadowAiEntry } from "./shadowAi";

const activity = {
  agentRef: "svc-reporting-bot",
  eventCount: 3,
  firstSeenAt: "2026-09-24T10:00:00Z",
  lastSeenAt: "2026-09-25T10:00:00Z",
  sources: ["mcp"],
  applications: ["Snowflake"],
  tools: ["query_customers"],
  actions: ["READ"],
};

describe("shadowAiEntry (IDENTITY-P0-12)", () => {
  it("is an open shadow_ai candidate keyed to the runtime source, with evidence and no guessed owner", () => {
    const e = shadowAiEntry(activity, undefined);
    expect(e).toMatchObject({
      category: "shadow_ai",
      integrationId: "runtime",
      sourceSystem: "runtime",
      externalId: "svc-reporting-bot",
      candidateStatus: "open",
      owner: null,
      application: "Snowflake",
      lastSeenAt: "2026-09-25T10:00:00Z",
    });
    expect(e.signals.map((s) => s.signal)).toEqual(["Runtime activity from an unregistered agent", "Tool calls", "MCP runtime source"]);
    // 60 + 15 + 10: strong evidence at high confidence.
    expect(e.confidenceScore).toBe(85);
    expect(e.confidenceLevel).toBe("HIGH");
    expect(e.classification).toBe("CONFIRMED_AGENT");
    expect(e.raw).toMatchObject({ events: 3, tools: ["query_customers"] });
  });

  it("with only plain REST activity it is a probable agent at medium confidence", () => {
    const e = shadowAiEntry({ ...activity, sources: ["rest"], tools: [] }, undefined);
    expect(e.confidenceScore).toBe(60);
    expect(e.confidenceLevel).toBe("MEDIUM");
    expect(e.classification).toBe("PROBABLE_AGENT");
  });

  it("carries a recorded ignore or link decision", () => {
    expect(shadowAiEntry(activity, { status: "ignored", matchedAgentId: null }).candidateStatus).toBe("ignored");
    const linked = shadowAiEntry(activity, { status: "linked", matchedAgentId: "agent-1" });
    expect(linked.candidateStatus).toBe("linked");
    expect(linked.linkedAgentId).toBe("agent-1");
  });
});
