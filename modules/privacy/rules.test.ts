// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  addMonths,
  breachObligations,
  canTransition,
  checkExtension,
  closeBreachRefusal,
  deadlineState,
  maxExtendedDueAt,
  minRetentionDays,
  requestReference,
  requiresApproval,
  responseDueAt,
  type BreachFacts,
} from "./rules";

const t = (iso: string) => new Date(iso);

describe("response deadlines — COMPLIANCE-P0-12", () => {
  it("GDPR: one calendar month, clamped to month end", () => {
    expect(responseDueAt("gdpr", t("2026-03-15T10:00:00Z")).toISOString()).toBe("2026-04-15T10:00:00.000Z");
    expect(responseDueAt("gdpr", t("2026-01-31T10:00:00Z")).toISOString()).toBe("2026-02-28T10:00:00.000Z");
    expect(addMonths(t("2028-01-31T00:00:00Z"), 1).toISOString()).toBe("2028-02-29T00:00:00.000Z");
  });
  it("DPDP: 90 days; CCPA: 45 days", () => {
    expect(responseDueAt("dpdp", t("2026-10-01T00:00:00Z")).toISOString()).toBe("2026-12-30T00:00:00.000Z");
    expect(responseDueAt("ccpa", t("2026-10-01T00:00:00Z")).toISOString()).toBe("2026-11-15T00:00:00.000Z");
  });
  it("extensions: GDPR up to three months total, DPDP none, only once and within the original deadline", () => {
    const received = t("2026-03-15T00:00:00Z");
    const due = responseDueAt("gdpr", received);
    expect(maxExtendedDueAt("gdpr", received)!.toISOString()).toBe("2026-06-15T00:00:00.000Z");
    expect(checkExtension("gdpr", received, due, t("2026-06-01T00:00:00Z"), t("2026-04-01T00:00:00Z"), false)).toBeNull();
    expect(checkExtension("gdpr", received, due, t("2026-07-01T00:00:00Z"), t("2026-04-01T00:00:00Z"), false)).toMatch(/at the latest/);
    expect(checkExtension("gdpr", received, due, t("2026-06-01T00:00:00Z"), t("2026-04-20T00:00:00Z"), false)).toMatch(/passed/);
    expect(checkExtension("gdpr", received, due, t("2026-06-01T00:00:00Z"), t("2026-04-01T00:00:00Z"), true)).toMatch(/already/);
    expect(checkExtension("dpdp", received, responseDueAt("dpdp", received), t("2026-07-01T00:00:00Z"), t("2026-04-01T00:00:00Z"), false)).toMatch(/no extension/);
  });
  it("deadline state", () => {
    const due = t("2026-10-10T00:00:00Z");
    expect(deadlineState("in_progress", due, t("2026-10-01T00:00:00Z"))).toBe("on_track");
    expect(deadlineState("in_progress", due, t("2026-10-05T00:00:00Z"))).toBe("due_soon");
    expect(deadlineState("received", due, t("2026-10-11T00:00:00Z"))).toBe("overdue");
    expect(deadlineState("completed", due, t("2026-10-11T00:00:00Z"))).toBe("closed");
  });
});

describe("request state machine", () => {
  it("allows the forward path and forbids reopening a closed request", () => {
    expect(canTransition("received", "identity_verification")).toBe(true);
    expect(canTransition("in_progress", "awaiting_approval")).toBe(true);
    expect(canTransition("awaiting_approval", "completed")).toBe(true);
    expect(canTransition("completed", "in_progress")).toBe(false);
    expect(canTransition("rejected", "completed")).toBe(false);
    expect(canTransition("received", "completed")).toBe(false);
  });
  it("erasure needs a second person's approval", () => {
    expect(requiresApproval("erasure")).toBe(true);
    expect(requiresApproval("access")).toBe(false);
  });
  it("references are well formed", () => {
    expect(requestReference("PR", t("2026-10-01T00:00:00Z"), () => 0)).toBe("PR-2026-222222");
    expect(requestReference("BR", t("2026-10-01T00:00:00Z"))).toMatch(/^BR-2026-[2-9A-HJ-NP-Z]{6}$/);
  });
});

describe("breach obligations", () => {
  const base: BreachFacts = {
    regimes: ["gdpr"],
    riskToIndividuals: "risk",
    detectedAt: t("2026-10-01T00:00:00Z"),
    authorityNotifiedAt: null,
    dpbNotifiedAt: null,
    dpbReportAt: null,
    subjectsNotifiedAt: null,
    status: "open",
  };
  it("GDPR: authority within 72h when there is a risk; individuals only when high risk", () => {
    const ob = breachObligations(base, t("2026-10-02T00:00:00Z"));
    const authority = ob.find((o) => o.key === "authority")!;
    expect(authority.dueAt!.toISOString()).toBe("2026-10-04T00:00:00.000Z");
    expect(authority.state).toBe("pending");
    expect(ob.find((o) => o.key === "subjects")!.state).toBe("not_required");
    expect(breachObligations(base, t("2026-10-04T00:00:01Z")).find((o) => o.key === "authority")!.state).toBe("overdue");
    expect(breachObligations({ ...base, riskToIndividuals: "high_risk" }, t("2026-10-02T00:00:00Z")).find((o) => o.key === "subjects")!.state).toBe("pending");
  });
  it("GDPR: no authority notice needed when a risk is unlikely", () => {
    expect(breachObligations({ ...base, riskToIndividuals: "unlikely" }, t("2026-10-09T00:00:00Z")).find((o) => o.key === "authority")!.state).toBe("not_required");
  });
  it("DPDP: Board intimation and every Data Principal regardless of risk, report within 72h", () => {
    const ob = breachObligations({ ...base, regimes: ["dpdp"], riskToIndividuals: "unlikely" }, t("2026-10-02T00:00:00Z"));
    expect(ob.map((o) => o.key)).toEqual(["dpb_intimation", "dpb_report", "subjects"]);
    expect(ob.find((o) => o.key === "dpb_intimation")!.state).toBe("overdue");
    expect(ob.find((o) => o.key === "dpb_report")!.state).toBe("pending");
    expect(ob.find((o) => o.key === "subjects")!.state).toBe("pending");
  });
  it("closing needs every required notice or a reason", () => {
    const facts: BreachFacts = { ...base, regimes: ["dpdp"] };
    expect(closeBreachRefusal(facts, null, t("2026-10-02T00:00:00Z"))).toMatch(/Record these/);
    expect(closeBreachRefusal(facts, "Board portal outage; notified by email on 2 Oct", t("2026-10-02T00:00:00Z"))).toBeNull();
    const done: BreachFacts = { ...facts, dpbNotifiedAt: t("2026-10-01T02:00:00Z"), dpbReportAt: t("2026-10-02T00:00:00Z"), subjectsNotifiedAt: t("2026-10-01T05:00:00Z") };
    expect(closeBreachRefusal(done, null, t("2026-10-03T00:00:00Z"))).toBeNull();
  });
});

describe("retention floors", () => {
  it("keeps audit logs at least a year", () => {
    expect(minRetentionDays("audit_logs")).toBe(365);
    expect(minRetentionDays("notifications")).toBe(30);
  });
});
