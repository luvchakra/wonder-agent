// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/platform-admin/service", () => ({
  resolveAiProviderKey: vi.fn(),
}));

import { retrieveSections, answerHelpQuestion } from "./helpAnswer";
import { GUIDE_SECTIONS } from "@/modules/ui/help/content";
import { resolveAiProviderKey } from "@/modules/platform-admin/service";

const mockResolve = vi.mocked(resolveAiProviderKey);

describe("retrieveSections — deterministic guide retrieval", () => {
  it("routes a password question to the sign-in/security section", () => {
    const hits = retrieveSections("how do I reset my password?");
    expect(hits[0]?.id).toBe("sso-security");
  });

  it("routes an integration question to the integrations section", () => {
    const hits = retrieveSections("how do I connect Saviynt?");
    expect(hits[0]?.id).toBe("integrations");
  });

  it("distinguishes the CAN/DID concepts question from the runtime screen", () => {
    const hits = retrieveSections("what is the difference between SHOULD CAN and DID?");
    expect(hits[0]?.id).toBe("should-can-did");
  });

  it("finds the FAQ entry for an empty-state question", () => {
    const hits = retrieveSections("why do I have no findings at all?");
    expect(hits.map((s) => s.id)).toContain("faq-no-findings");
  });

  it("routes questions about the newer areas to their sections", () => {
    expect(retrieveSections("how do I request access?")[0]?.id).toBe("access-requests");
    expect(retrieveSections("what do the agent lifecycle states mean?")[0]?.id).toBe("agent-lifecycle");
    expect(retrieveSections("how does an agent get approved?")[0]?.id).toBe("agent-lifecycle");
    expect(retrieveSections("what is the home dashboard?")[0]?.id).toBe("home-overview");
    expect(retrieveSections("how do I import people from a csv?")[0]?.id).toBe("identity-sources");
    expect(retrieveSections("what happens when someone leaves?")[0]?.id).toBe("identity-lifecycle");
    expect(retrieveSections("where is the kill switch?")[0]?.id).toBe("emergency-controls");
  });

  it("sends a sign-in problem with a social provider to the sign-in section", () => {
    expect(retrieveSections("why can't Google sign in work?")[0]?.id).toBe("sso-security");
  });

  it("offers the troubleshooting entry for a general 'it is not working' or contact question", () => {
    expect(retrieveSections("something is not working").map((s) => s.id)).toContain("faq-something-wrong");
    expect(retrieveSections("how do I contact support?")[0]?.id).toBe("faq-something-wrong");
  });

  it("returns nothing for a question the guide does not cover", () => {
    expect(retrieveSections("kubernetes helm chart rollout strategy")).toEqual([]);
  });

  it("returns nothing for an empty or stopword-only question", () => {
    expect(retrieveSections("")).toEqual([]);
    expect(retrieveSections("what is it")).toEqual([]);
  });

  it("never returns more than the requested number of sections", () => {
    expect(retrieveSections("agent access risk runtime policy", 2).length).toBeLessThanOrEqual(2);
  });

  it("only ever returns sections that actually exist in the guide", () => {
    // The property the whole design rests on: links come from retrieval, so
    // an answer cannot cite a section the page does not render.
    const ids = new Set(GUIDE_SECTIONS.map((s) => s.id));
    for (const q of ["agents", "certification campaign", "who can see what", "rogue"]) {
      for (const hit of retrieveSections(q)) expect(ids.has(hit.id)).toBe(true);
    }
  });
});

describe("answerHelpQuestion — degradation without an AI provider", () => {
  it("answers from the guide text when no provider is configured", async () => {
    mockResolve.mockResolvedValue(null);
    const result = await answerHelpQuestion("tenant-1", "how do I connect Saviynt?");
    expect(result.source).toBe("guide");
    expect(result.sections[0]?.href).toBe("/help#integrations");
    expect(result.answer.length).toBeGreaterThan(0);
  });

  it("still returns guide sections when the provider call itself fails", async () => {
    mockResolve.mockResolvedValue({
      source: "platform",
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-4o-mini",
    });
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;

    const result = await answerHelpQuestion("tenant-1", "how do I connect Saviynt?");
    expect(result.source).toBe("guide");
    expect(result.sections[0]?.id).toBe("integrations");

    global.fetch = originalFetch;
  });

  it("uses the model's prose when a provider answers, keeping retrieval's links", async () => {
    mockResolve.mockResolvedValue({
      source: "byok",
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-4o-mini",
    });
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "Connect it under Integrations." } }] }),
    }) as unknown as typeof fetch;

    const result = await answerHelpQuestion("tenant-1", "how do I connect Saviynt?");
    expect(result.source).toBe("ai");
    expect(result.answer).toBe("Connect it under Integrations.");
    expect(result.sections[0]?.id).toBe("integrations");

    global.fetch = originalFetch;
  });

  it("says so plainly when the guide does not cover the question, with no sections", async () => {
    mockResolve.mockResolvedValue(null);
    const result = await answerHelpQuestion("tenant-1", "kubernetes helm chart rollout");
    expect(result.sections).toEqual([]);
    expect(result.answer).toMatch(/couldn't find/i);
  });
});
