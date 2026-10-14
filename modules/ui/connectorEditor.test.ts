import { describe, expect, it } from "vitest";
import { validateDefinition } from "@/modules/integrations/framework/validate";
import type { ConnectorDefinition } from "@/modules/integrations/framework/types";
import { FORM_AUTH_TYPES, FORM_PAGINATION_TYPES, authPreset, newResource, paginationPreset, pathOf, resourceOf, samplePaths, withFieldPath, withResource } from "./connectorEditor";

const def: ConnectorDefinition = {
  schemaVersion: 1,
  key: "acme",
  version: "1.0.0",
  name: "Acme",
  category: "application",
  description: "Acme accounts",
  driver: "http",
  settings: [{ key: "baseUrl", label: "Address", type: "url", required: true }],
  auth: authPreset("bearer"),
  test: { request: { path: "/me" } },
  resources: { account: { request: { path: "/users" }, records: "data", pagination: paginationPreset("page"), fields: { externalId: "id", email: { path: "mail", transform: ["lower"] } } } },
};

describe("connector editor (EXPERIENCE-P0-30)", () => {
  it("every auth and pagination preset passes the server's rules", () => {
    for (const type of FORM_AUTH_TYPES) expect(validateDefinition({ ...def, auth: authPreset(type) }).issues, type).toEqual([]);
    for (const type of FORM_PAGINATION_TYPES) {
      const account = { ...resourceOf(def, "account")!, pagination: paginationPreset(type) };
      expect(validateDefinition(withResource(def, "account", account)).issues, type).toEqual([]);
    }
  });

  it("sets a field's path, keeping its transforms, and removes it when emptied", () => {
    const fields = resourceOf(def, "account")!.fields;
    expect(withFieldPath(fields, "username", " login ")).toMatchObject({ username: "login" });
    expect(withFieldPath(fields, "email", "profile.email").email).toEqual({ path: "profile.email", transform: ["lower"] });
    expect(withFieldPath(fields, "email", "")).not.toHaveProperty("email");
  });

  it("reads simple paths only; templates and constants stay for the JSON view", () => {
    expect(pathOf("id")).toBe("id");
    expect(pathOf({ path: "mail", transform: ["lower"] })).toBe("mail");
    expect(pathOf(undefined)).toBe("");
    expect(pathOf({ template: "{record.a}" })).toBeNull();
    expect(pathOf({ value: "x" })).toBeNull();
    expect(pathOf({ path: ["a", "b"] })).toBeNull();
  });

  it("edits the first request of a kind that lists several and keeps the rest", () => {
    const two = { ...def, resources: { entitlement: [newResource(["externalId", "name"]), { request: { path: "/roles" }, fields: { externalId: "id", name: "name" } }] } } as ConnectorDefinition;
    const next = withResource(two, "entitlement", { ...resourceOf(two, "entitlement")!, records: "items" });
    expect(next.resources.entitlement).toHaveLength(2);
    expect((next.resources.entitlement as { records?: string }[])[0].records).toBe("items");
  });

  it("lists a sample's paths in the definition's syntax, with examples", () => {
    const paths = samplePaths({ id: 7, profile: { email: "a@x.test" }, groups: [{ name: "ops" }, { name: "fin" }], tags: ["a", "b"], note: null });
    expect(paths.map((p) => p.path)).toEqual(["id", "profile.email", "groups[].name", "tags", "note"]);
    expect(paths.find((p) => p.path === "profile.email")?.example).toBe("a@x.test");
    expect(samplePaths({ long: "x".repeat(100) })[0].example).toHaveLength(58);
    expect(samplePaths(Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`k${i}`, i])))).toHaveLength(200);
  });
});
