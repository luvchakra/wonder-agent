import { describe, expect, it } from "vitest";
import { isStructurallyAllowedTransition } from "./lifecycle";
import type { AgentLifecycleState } from "@/lib/shared/types/agent-identity";

const ALL_STATES: AgentLifecycleState[] = [
  "DISCOVERED",
  "REGISTERED",
  "ASSESSED",
  "APPROVED",
  "PROVISIONED",
  "ACTIVE",
  "CERTIFICATION_DUE",
  "RESTRICTED",
  "SUSPENDED",
  "RETIRED",
];

describe("isStructurallyAllowedTransition — IDENTITY-P0-02.1 transition table", () => {
  it("allows every normal forward transition in the backlog's table", () => {
    expect(isStructurallyAllowedTransition("DISCOVERED", "REGISTERED")).toBe(true);
    expect(isStructurallyAllowedTransition("REGISTERED", "APPROVED")).toBe(true);
    expect(isStructurallyAllowedTransition("APPROVED", "PROVISIONED")).toBe(true);
    expect(isStructurallyAllowedTransition("PROVISIONED", "ACTIVE")).toBe(true);
    expect(isStructurallyAllowedTransition("ACTIVE", "CERTIFICATION_DUE")).toBe(true);
    expect(isStructurallyAllowedTransition("ACTIVE", "RESTRICTED")).toBe(true);
    expect(isStructurallyAllowedTransition("CERTIFICATION_DUE", "ACTIVE")).toBe(true);
    expect(isStructurallyAllowedTransition("RESTRICTED", "SUSPENDED")).toBe(true);
    expect(isStructurallyAllowedTransition("SUSPENDED", "RETIRED")).toBe(true);
  });

  it("allows the 'any state -> SUSPENDED' emergency wildcard, except from RETIRED", () => {
    for (const from of ALL_STATES) {
      const expected = from !== "RETIRED";
      expect(isStructurallyAllowedTransition(from, "SUSPENDED")).toBe(expected);
    }
  });

  it("rejects transitions never listed in the table", () => {
    expect(isStructurallyAllowedTransition("DISCOVERED", "ACTIVE")).toBe(false);
    expect(isStructurallyAllowedTransition("ACTIVE", "DISCOVERED")).toBe(false);
    expect(isStructurallyAllowedTransition("RETIRED", "ACTIVE")).toBe(false);
    expect(isStructurallyAllowedTransition("APPROVED", "RESTRICTED")).toBe(false);
  });

  it("RETIRED is terminal: no transition out of it is allowed", () => {
    for (const to of ALL_STATES) {
      if (to === "RETIRED") continue;
      expect(isStructurallyAllowedTransition("RETIRED", to)).toBe(false);
    }
  });

  it("every state can reach RETIRED only via SUSPENDED -> RETIRED", () => {
    for (const from of ALL_STATES) {
      const allowed = isStructurallyAllowedTransition(from, "RETIRED");
      expect(allowed).toBe(from === "SUSPENDED");
    }
  });
});
