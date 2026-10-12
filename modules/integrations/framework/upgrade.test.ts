import { describe, expect, it } from "vitest";
import { compareVersions, planUpgrade, upgradedCapabilities } from "./upgrade";
import type { ConnectorDefinition } from "./types";

const v1: ConnectorDefinition = {
  schemaVersion: 1,
  key: "acme",
  version: "1.0.0",
  name: "Acme",
  category: "application",
  description: "x",
  driver: "http",
  settings: [{ key: "baseUrl", label: "Address", type: "url", required: true }],
  auth: { type: "bearer", token: "{secret.token}", fields: [{ key: "token", label: "API token" }] },
  test: { request: { path: "/ping" } },
  resources: {
    account: { request: { path: "/users" }, records: "", fields: { externalId: "id", username: "login", email: "mail" } },
  },
  write: { revoke_access: { request: { method: "DELETE", path: "/g/{target.entitlement}/m/{target.account}" } } },
};

const v2 = (patch: Partial<ConnectorDefinition>): ConnectorDefinition => ({ ...v1, version: "1.1.0", ...patch });
const settings = { baseUrl: "https://acme.example" };

describe("connection upgrade (INTEGRATION-P0-21 part 4)", () => {
  it("orders versions numerically", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBe(1);
    expect(compareVersions("2.0.0", "2.0.0")).toBe(0);
    expect(compareVersions("0.9.0", "1.0.0")).toBe(-1);
  });

  it("lists mapping, read and setting changes, keeping settings and defaulting new ones", () => {
    const to = v2({
      settings: [...v1.settings, { key: "pageSize", label: "Page size", type: "number", default: 100 }],
      resources: {
        account: { request: { path: "/v2/users" }, records: "", fields: { externalId: "id", username: { path: "login", transform: ["lower"] }, displayName: "name" } },
        entitlement: { request: { path: "/groups" }, records: "", fields: { externalId: "id", name: "name" } },
      },
    });
    const plan = planUpgrade(v1, to, settings, ["token"], false);
    expect(plan.blockers).toEqual([]);
    expect(plan.settings).toEqual({ baseUrl: "https://acme.example", pageSize: 100 });
    const texts = plan.changes.map((c) => c.text);
    expect(texts).toEqual(
      expect.arrayContaining([
        "New setting: Page size (100)",
        expect.stringMatching(/read differently/),
        expect.stringMatching(/username is mapped differently/),
        expect.stringMatching(/new field displayName/),
        expect.stringMatching(/field email is no longer filled/),
        expect.stringMatching(/^Starts reading/),
      ]),
    );
    expect(plan.writes).toBe("none");
  });

  it("blocks a change of protocol or sign-in style, a new required setting, and a new required credential", () => {
    expect(planUpgrade(v1, v2({ driver: "ldap" }), settings, ["token"], false).blockers.join(" ")).toMatch(/protocol changes/);
    expect(planUpgrade(v1, v2({ auth: { type: "basic", username: "{secret.u}", password: "{secret.p}", fields: [{ key: "u", label: "User" }, { key: "p", label: "Password" }] } }), settings, ["token"], false).blockers.join(" ")).toMatch(/Sign-in changes/);
    expect(planUpgrade(v1, v2({ settings: [...v1.settings, { key: "tenant", label: "Tenant", type: "string", required: true }] }), settings, ["token"], false).blockers.join(" ")).toMatch(/Settings:/);
    const newSecret = v2({ auth: { type: "bearer", token: "{secret.token}", fields: [{ key: "token", label: "API token" }, { key: "org", label: "Org id" }] } });
    expect(planUpgrade(v1, newSecret, settings, ["token"], false).blockers.join(" ")).toMatch(/Org id/);
    expect(planUpgrade(v1, newSecret, settings, ["token", "org"], false).blockers).toEqual([]);
    expect(planUpgrade(v1, v1, settings, ["token"], false).blockers.join(" ")).toMatch(/already uses/);
    expect(planUpgrade(v1, v2({ key: "other" }), settings, ["token"], false).blockers.join(" ")).toMatch(/another connection type/);
  });

  it("never widens changes in the system: a version that can do more turns writes off", () => {
    const more = v2({ write: { ...v1.write, grant_access: { request: { method: "PUT", path: "/g/{target.entitlement}/m/{target.account}" } } } });
    const plan = planUpgrade(v1, more, settings, ["token"], true);
    expect(plan.writes).toBe("turned_off");
    expect(plan.changes.map((c) => c.text)).toEqual(expect.arrayContaining(["Can now add access", expect.stringMatching(/turn off/)]));
    expect(upgradedCapabilities(more, plan)).toMatchObject({ revokeAccess: false, grantAccess: false, deprovision: false, provision: false });

    const same = v2({});
    const kept = planUpgrade(v1, same, settings, ["token"], true);
    expect(kept.writes).toBe("kept");
    expect(upgradedCapabilities(same, kept)).toMatchObject({ revokeAccess: true, deprovision: true, grantAccess: false });
  });
});
