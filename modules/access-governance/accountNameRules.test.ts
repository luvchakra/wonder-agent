import { describe, expect, it } from "vitest";
import { accountDisplayName, agentAccountName, defaultAccountName, formatAccountName, uniqueAccountName, validateAccountNameFormat } from "./accountNameRules";

const jane = { displayName: "Jane van Doe", email: "Jane.Doe@acme.example", username: null };

describe("account name format (ACCESS-P0-16/28)", () => {
  it("accepts a format of known placeholders and safe literals; empty is the default", () => {
    expect(validateAccountNameFormat(" {firstName}.{lastName} ")).toBe("{firstName}.{lastName}");
    expect(validateAccountNameFormat("{emailName:lower}")).toBe("{emailName:lower}");
    expect(validateAccountNameFormat("adm-{username}")).toBe("adm-{username}");
    expect(validateAccountNameFormat("")).toBeNull();
    expect(validateAccountNameFormat(undefined)).toBeNull();
  });
  it("rejects unknown placeholders, no placeholder, unsafe literals and long formats", () => {
    expect(() => validateAccountNameFormat("{employeeId}")).toThrow(/unknown placeholder/);
    expect(() => validateAccountNameFormat("jane")).toThrow(/at least one placeholder/);
    expect(() => validateAccountNameFormat("{firstName} {lastName}")).toThrow(/only letters/);
    expect(() => validateAccountNameFormat("{firstName},{lastName}")).toThrow(/only letters/);
    expect(() => validateAccountNameFormat(`{username}${"x".repeat(100)}`)).toThrow(/at most/);
    expect(() => validateAccountNameFormat(42)).toThrow(/text/);
  });
  it("applies a format to the identity's own attributes", () => {
    expect(formatAccountName("{firstName}.{lastName}", jane)).toBe("Jane.Doe");
    expect(formatAccountName("{firstName:lower}.{lastName:lower}", jane)).toBe("jane.doe");
    expect(formatAccountName("{email}", jane)).toBe("Jane.Doe@acme.example");
    expect(formatAccountName("{emailName:lower}", jane)).toBe("jane.doe");
    expect(formatAccountName("{firstName}", { displayName: "José Núñez", email: null, username: null })).toBe("Jose");
  });
  it("falls back to the default when a placeholder has no value, never half a name", () => {
    expect(formatAccountName("{firstName}.{lastName}", { displayName: "Cher", email: "cher@acme.example", username: null })).toBe("cher");
    expect(formatAccountName("{username}", jane)).toBe("jane.doe");
  });
  it("defaults to the username, else the email name, else first.last", () => {
    expect(defaultAccountName({ displayName: "Ana Lima", email: "ana@x.example", username: "alima" })).toBe("alima");
    expect(defaultAccountName({ displayName: "Ana Lima", email: "Ana@x.example", username: null })).toBe("ana");
    expect(defaultAccountName({ displayName: "Ana Lima", email: null, username: null })).toBe("ana.lima");
    expect(defaultAccountName({ displayName: null, email: null, username: null })).toBeNull();
    expect(formatAccountName(null, { displayName: "Ana Lima", email: null, username: null })).toBe("ana.lima");
  });
  it("names an agent's account by its name as a slug", () => {
    expect(agentAccountName("Finance Bot")).toBe("finance-bot");
    expect(agentAccountName("  FinanceBot (prod) ")).toBe("financebot-prod");
    expect(agentAccountName("")).toBeNull();
  });
  it("keeps names unique in the application with -2, -3, ignoring case", () => {
    expect(uniqueAccountName("jane.doe", [])).toBe("jane.doe");
    expect(uniqueAccountName("jane.doe", ["Jane.Doe"])).toBe("jane.doe-2");
    expect(uniqueAccountName("jane.doe", ["jane.doe", "jane.doe-2"])).toBe("jane.doe-3");
    expect(uniqueAccountName("a", ["a", ...Array.from({ length: 19 }, (_, i) => `a-${i + 2}`)])).toBeNull();
  });
  it("shows a name, never a placeholder's internal reference", () => {
    expect(accountDisplayName("jane.doe", "pending:61f7285b-7ee8-4a24-986e-8bc2dded9188")).toBe("jane.doe");
    expect(accountDisplayName(null, "pending:61f7285b-7ee8-4a24-986e-8bc2dded9188")).toBe("to be created");
    expect(accountDisplayName(null, "ana")).toBe("ana");
    expect(accountDisplayName(null, null)).toBeNull();
  });
});
