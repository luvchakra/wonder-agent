// @vitest-environment node
import { describe, expect, it } from "vitest";
import { applyMappings } from "./mappings";
import type { IntegrationMapping } from "@/lib/shared/types/integrations";

function mapping(sourceField: string, targetField: string): IntegrationMapping {
  return { id: "m1", integrationId: "i1", objectType: "account", sourceField, targetField };
}

describe("applyMappings — INTEGRATION-P0-03.2", () => {
  it("copies top-level fields by name", () => {
    const raw = { accountname: "svc-finance-ai", endpoint: "Snowflake" };
    const result = applyMappings(raw, [mapping("accountname", "externalId"), mapping("endpoint", "application")]);
    expect(result).toEqual({ externalId: "svc-finance-ai", application: "Snowflake" });
  });

  it("resolves nested fields via dot path", () => {
    const raw = { user: { profile: { email: "a@example.com" } } };
    const result = applyMappings(raw, [mapping("user.profile.email", "email")]);
    expect(result).toEqual({ email: "a@example.com" });
  });

  it("leaves a target field undefined when the source path is missing", () => {
    const raw = { foo: "bar" };
    const result = applyMappings(raw, [mapping("does.not.exist", "target")]);
    expect(result).toEqual({ target: undefined });
  });

  it("returns an empty object when there are no mappings", () => {
    expect(applyMappings({ a: 1 }, [])).toEqual({});
  });
});
