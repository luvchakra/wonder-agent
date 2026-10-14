import { describe, expect, it } from "vitest";
import { approvalLinkPath, approvalLinkState, isLinkToken } from "./approvalLinkRules";
import { validateDraft } from "./requestBasketRules";

const now = new Date("2026-10-14T10:00:00Z");
const link = { userId: "u1", requestId: "r1", expiresAt: "2026-10-15T10:00:00Z", usedAt: null as string | null };
const ctx = { userId: "u1", requestId: "r1", requestStatus: "pending", now };

describe("approval links (ACCESS-P0-38 part 2)", () => {
  it("is valid once, for the approver it was sent to, while the request waits and before it expires", () => {
    expect(approvalLinkState(link, ctx)).toBe("valid");
    expect(approvalLinkState({ ...link, usedAt: "2026-10-14T09:00:00Z" }, ctx)).toBe("used");
    expect(approvalLinkState({ ...link, expiresAt: "2026-10-14T09:59:59Z" }, ctx)).toBe("expired");
    expect(approvalLinkState(link, { ...ctx, userId: "u2" })).toBe("not_yours");
    expect(approvalLinkState(link, { ...ctx, requestStatus: "approved" })).toBe("decided");
    expect(approvalLinkState(link, { ...ctx, requestId: "r2" })).toBe("unknown");
    expect(approvalLinkState(null, ctx)).toBe("unknown");
  });

  it("only accepts a 32-byte URL-safe token and links to the request page", () => {
    const token = "a".repeat(43);
    expect(isLinkToken(token)).toBe(true);
    expect(isLinkToken("a".repeat(42))).toBe(false);
    expect(isLinkToken(`${"a".repeat(42)}/`)).toBe(false);
    expect(approvalLinkPath("r1", token)).toBe(`/access/requests/r1?link=${token}`);
  });
});

describe("request drafts (ACCESS-P0-38 part 2)", () => {
  const A = "11111111-1111-1111-1111-111111111111";
  const APP = "33333333-3333-3333-3333-333333333333";
  const E = "44444444-4444-4444-4444-444444444444";
  it("keeps an unfinished basket in a basket's shape", () => {
    expect(validateDraft({ name: " Onboarding ", payload: { subjectIdentityIds: [A, A], items: [`${APP}|${E}`, `${APP}|`], justification: "x" } })).toEqual({
      name: "Onboarding",
      payload: { subjectIdentityIds: [A], items: [`${APP}|${E}`, `${APP}|`], justification: "x" },
    });
    expect(validateDraft({ name: "Empty", payload: {} })).toEqual({ name: "Empty", payload: { subjectIdentityIds: [], items: [], justification: "" } });
    expect(validateDraft({ name: "" })).toMatchObject({ error: expect.stringContaining("name") });
    expect(validateDraft({ name: "x", payload: { subjectIdentityIds: ["me"] } })).toMatchObject({ error: expect.stringContaining("subjectIdentityIds") });
    expect(validateDraft({ name: "x", payload: { items: ["drop table"] } })).toMatchObject({ error: expect.stringContaining("items") });
  });
});
