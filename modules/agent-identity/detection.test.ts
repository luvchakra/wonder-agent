// @vitest-environment node
import { describe, expect, it } from "vitest";
import { classifyAgentSignal } from "./detection";

describe("classifyAgentSignal — Agent Discovery detection/confidence", () => {
  it("classifies a plain human identity as NON_AGENT with zero score", () => {
    const result = classifyAgentSignal({
      sourceName: "Saviynt",
      displayName: "Jane Doe",
      normalized: { identityType: "human" },
      raw: { username: "jane.doe", firstname: "Jane", lastname: "Doe" },
    });
    expect(result.classification).toBe("NON_AGENT");
    expect(result.confidenceScore).toBe(0);
    expect(result.signals).toEqual([]);
  });

  it("returns UNKNOWN for a completely empty object", () => {
    const result = classifyAgentSignal({
      sourceName: "Saviynt",
      displayName: "",
      normalized: {},
      raw: {},
    });
    expect(result.classification).toBe("UNKNOWN");
  });

  it("classifies a bare service account (weak signal only) as POSSIBLE_AGENT / LOW — never over-confident from identity type alone", () => {
    const result = classifyAgentSignal({
      sourceName: "Saviynt",
      displayName: "SVC-BACKUP-JOB",
      normalized: { identityType: "service_account" },
      raw: { username: "SVC-BACKUP-JOB" },
    });
    expect(result.classification).toBe("POSSIBLE_AGENT");
    expect(result.confidenceLevel).toBe("LOW");
    expect(result.confidenceScore).toBeLessThan(50);
  });

  it("classifies an explicit AI-platform identifier as CONFIRMED_AGENT / HIGH with explainable strong evidence", () => {
    const result = classifyAgentSignal({
      sourceName: "Finance MCP",
      sourceCategory: "mcp",
      displayName: "FinanceBot",
      normalized: { identityType: "service_account" },
      raw: { agentId: "fin-bot-001", agentFramework: "langchain", tags: ["ai", "finance"] },
    });
    expect(result.classification).toBe("CONFIRMED_AGENT");
    expect(result.confidenceLevel).toBe("HIGH");
    expect(result.confidenceScore).toBeGreaterThanOrEqual(80);
    expect(result.signals.some((s) => s.signal === "AI platform identifier")).toBe(true);
    expect(result.signals.every((s) => s.scoreContribution > 0)).toBe(true);
  });

  it("scores naming-pattern + platform metadata as PROBABLE_AGENT / MEDIUM without a definitive identifier", () => {
    const result = classifyAgentSignal({
      sourceName: "Generic REST",
      displayName: "Reporting Automation Agent",
      normalized: {},
      raw: { platform: "openai", description: "Automated reporting agent" },
    });
    expect(["PROBABLE_AGENT", "POSSIBLE_AGENT"]).toContain(result.classification);
    expect(result.confidenceLevel === "MEDIUM" || result.confidenceLevel === "HIGH").toBe(true);
  });

  it("caps the total score at 100 even when every signal matches", () => {
    const result = classifyAgentSignal({
      sourceName: "MCP",
      sourceCategory: "mcp",
      displayName: "Automation Copilot Bot",
      normalized: { identityType: "service_account" },
      raw: {
        agentId: "a1",
        agentFramework: "langchain",
        tags: ["ai-agent"],
        tools: ["read", "write"],
      },
    });
    expect(result.confidenceScore).toBeLessThanOrEqual(100);
  });
});
