// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isCrossSiteApiWrite } from "./origin";

const base = { method: "POST", pathname: "/api/v1/billing/checkout", host: "app.wonderid.example" };

describe("isCrossSiteApiWrite — FOUNDATION-P0-30", () => {
  it("refuses a browser write from another origin", () => {
    expect(isCrossSiteApiWrite({ ...base, origin: "https://evil.example" })).toBe(true);
    expect(isCrossSiteApiWrite({ ...base, origin: "null" })).toBe(true);
    expect(isCrossSiteApiWrite({ ...base, origin: "https://acme.wonderid.example" })).toBe(true);
  });
  it("allows same-origin writes, reads, and calls without an Origin", () => {
    expect(isCrossSiteApiWrite({ ...base, origin: "https://app.wonderid.example" })).toBe(false);
    expect(isCrossSiteApiWrite({ ...base, method: "GET", origin: "https://evil.example" })).toBe(false);
    expect(isCrossSiteApiWrite({ ...base, origin: null })).toBe(false);
  });
  it("leaves third-party callbacks to their own signature checks", () => {
    expect(isCrossSiteApiWrite({ ...base, pathname: "/api/v1/billing/webhooks/stripe", origin: "https://stripe.com" })).toBe(false);
    expect(isCrossSiteApiWrite({ ...base, pathname: "/api/gateway/v1/authorize", origin: "https://agent.example" })).toBe(false);
  });
  it("ignores non-API paths (server actions have Next's own origin check)", () => {
    expect(isCrossSiteApiWrite({ ...base, pathname: "/settings/billing", origin: "https://evil.example" })).toBe(false);
  });
});
