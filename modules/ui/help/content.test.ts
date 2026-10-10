import { describe, expect, it } from "vitest";
import { GUIDE_CATEGORIES, GUIDE_SECTIONS, getSection, sectionsByCategory } from "./content";

/**
 * The guide is one source for the /help page and the assistant, so these
 * checks guard the properties both rely on: every section can be linked
 * to, nothing is empty, and the copy stays free of internal technology
 * names and of the pre-rename product name.
 */
describe("user guide content", () => {
  it("has unique section ids (they are the /help#<id> anchors)", () => {
    const ids = GUIDE_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it("gives every section a category the page renders, a summary, a body and keywords", () => {
    for (const s of GUIDE_SECTIONS) {
      expect(GUIDE_CATEGORIES, s.id).toContain(s.category);
      expect(s.title.trim(), s.id).not.toBe("");
      expect(s.summary.trim(), s.id).not.toBe("");
      expect(s.body.length, s.id).toBeGreaterThan(0);
      for (const p of s.body) expect(p.trim(), s.id).not.toBe("");
      expect(s.keywords.length, s.id).toBeGreaterThan(0);
    }
  });

  it("renders every category that has sections, and none that is empty", () => {
    for (const c of GUIDE_CATEGORIES) expect(sectionsByCategory(c).length, c).toBeGreaterThan(0);
  });

  it("only links 'Open in app' to in-app paths", () => {
    for (const s of GUIDE_SECTIONS) if (s.href) expect(s.href, s.id).toMatch(/^\/[a-z0-9/_-]*$/);
  });

  it("documents the areas the product has today", () => {
    for (const id of [
      "home-overview",
      "identities",
      "identity-lifecycle",
      "identity-sources",
      "register-agents",
      "agent-lifecycle",
      "agent-contract",
      "applications",
      "accounts",
      "effective-access",
      "access-requests",
      "access-packages",
      "policies",
      "runtime-gateway",
      "findings",
      "certification",
      "audit-integrity",
      "sso-security",
      "global-configuration",
      "control-center",
      "separation-of-duties",
      "faq-something-wrong",
    ]) {
      expect(getSection(id), id).toBeDefined();
    }
  });

  it("names the agent lifecycle states the product actually has", () => {
    const text = getSection("agent-lifecycle")!.body.join(" ");
    for (const state of ["Discovered", "Registered", "Assessed", "Approved", "Provisioned", "Active", "Certification due", "Restricted", "Suspended", "Retired"]) {
      expect(text).toContain(state);
    }
    // "proposed" was a state this guide once named that does not exist.
    expect(GUIDE_SECTIONS.flatMap((s) => s.body).join(" ")).not.toMatch(/\bproposed,/i);
  });

  it("does not promise a social sign-in provider is switched on", () => {
    const text = getSection("sso-security")!.body.join(" ");
    expect(text).toMatch(/only once that provider has been enabled/i);
    expect(text).not.toMatch(/are available from the sign-in screen/i);
  });

  it("keeps internal technology out of customer-facing text", () => {
    const text = GUIDE_SECTIONS.flatMap((s) => [s.title, s.summary, ...s.body]).join("\n");
    expect(text).not.toMatch(/supabase|postgres|vercel|next\.js|row[- ]level security|\bRLS\b|resend/i);
    expect(text).not.toMatch(/the database\b/i);
  });

  it("uses the product's current name; the old name appears only as history", () => {
    const visible = GUIDE_SECTIONS.flatMap((s) => [s.title, s.summary, ...s.body]);
    const stale = visible.filter((t) => /WonderAgent/.test(t));
    expect(stale).toHaveLength(1);
    expect(stale[0]).toMatch(/formerly called WonderAgent/);
  });

  it("never invents a support address or response-time promise", () => {
    const text = GUIDE_SECTIONS.flatMap((s) => [s.summary, ...s.body]).join("\n");
    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/\b(24\/7|SLA)\b|we (will )?(reply|respond)/);
  });
});
