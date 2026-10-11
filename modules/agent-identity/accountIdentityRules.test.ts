import { describe, expect, it } from "vitest";
import { resolveOwner } from "./accountIdentityRules";

const people = [
  { id: "11111111-1111-4111-8111-111111111111", email: "ana@example.com", username: "ana", sourceNativeId: "E100" },
  { id: "22222222-2222-4222-8222-222222222222", email: "bo@example.com", username: "bo", sourceNativeId: "E200" },
  { id: "33333333-3333-4333-8333-333333333333", email: "twin@example.com", username: "t1", sourceNativeId: null },
  { id: "44444444-4444-4444-8444-444444444444", email: "TWIN@example.com", username: "t2", sourceNativeId: null },
];

describe("resolveOwner", () => {
  it("names one person by WonderID id, source id, email (any case) or username", () => {
    expect(resolveOwner("11111111-1111-4111-8111-111111111111", people)).toBe(people[0].id);
    expect(resolveOwner("E200", people)).toBe(people[1].id);
    expect(resolveOwner("ANA@example.com", people)).toBe(people[0].id);
    expect(resolveOwner("bo", people)).toBe(people[1].id);
  });

  it("names nobody when the value is empty, unknown or ambiguous: no guessed owner", () => {
    expect(resolveOwner(null, people)).toBeNull();
    expect(resolveOwner("  ", people)).toBeNull();
    expect(resolveOwner("someone@else.com", people)).toBeNull();
    expect(resolveOwner("twin@example.com", people)).toBeNull();
  });
});
