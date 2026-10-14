import { describe, expect, it } from "vitest";
import { connectionTypeKeyOf, missingAnswers, questionKey, templateFits, validateAnswers, validateTemplate, type ValidTemplate } from "./onboardingTemplateRules";

const OWNER = "11111111-2222-3333-4444-555555555555";

describe("onboarding templates (ACCESS-P0-34)", () => {
  it("takes the configuration defaults, owners, entitlement types and questions", () => {
    const t = validateTemplate({
      name: " REST apps ",
      connectionTypeKey: "workday",
      defaults: {
        accountIdentifierField: "id",
        correlationAccountField: "email",
        correlationIdentityField: "email",
        entitlementSource: "connector",
        requestPolicy: "manager_approval",
        grantAccess: true,
        businessOwnerIdentityId: OWNER,
        ignored: 1,
      },
      entitlementTypes: [{ name: "role", requestMode: "single", maxDurationDays: 90 }],
      questions: [
        { label: "Does it hold customer data?", type: "yes_no", required: true },
        { label: "Hosting", type: "choice", options: ["SaaS", "On premises", "SaaS"] },
      ],
    }) as ValidTemplate;
    expect(t.name).toBe("REST apps");
    expect(t.defaults.config).toEqual({
      accountIdentifierField: "id",
      correlationAccountField: "email",
      correlationIdentityField: "email",
      entitlementSource: "connector",
      requestPolicy: "manager_approval",
      grantAccess: true,
    });
    expect(t.defaults).toMatchObject({ businessOwnerIdentityId: OWNER, technicalOwnerIdentityId: null });
    expect(t.entitlement_types).toEqual([{ name: "role", request_mode: "single", max_duration_days: 90 }]);
    expect(t.questions).toEqual([
      { key: "does_it_hold_customer_data", label: "Does it hold customer data?", type: "yes_no", required: true },
      { key: "hosting", label: "Hosting", type: "choice", options: ["SaaS", "On premises"], required: false },
    ]);
  });

  it("refuses what the onboarding itself would refuse", () => {
    expect(validateTemplate({ name: "" })).toMatchObject({ error: expect.stringContaining("name") });
    expect(validateTemplate({ name: "x", defaults: { requestPolicy: "anyone" } })).toMatchObject({ error: expect.stringContaining("requestPolicy") });
    expect(validateTemplate({ name: "x", defaults: { accountIdentifierField: "bad field!" } })).toMatchObject({ error: expect.stringContaining("accountIdentifierField") });
    // Entitlements from the connector need a connection type.
    expect(validateTemplate({ name: "x", defaults: { entitlementSource: "connector" } })).toMatchObject({ error: expect.stringContaining("connection type") });
    expect(validateTemplate({ name: "x", defaults: { businessOwnerIdentityId: "me" } })).toMatchObject({ error: expect.stringContaining("businessOwnerIdentityId") });
    expect(validateTemplate({ name: "x", entitlementTypes: [{ name: "Role" }, { name: "role" }] })).toMatchObject({ error: expect.stringContaining("twice") });
    expect(validateTemplate({ name: "x", entitlementTypes: [{ name: "role", defaultDurationDays: 30, maxDurationDays: 10 }] })).toMatchObject({ error: expect.stringContaining("maximum") });
    expect(validateTemplate({ name: "x", questions: [{ label: "Pick", type: "choice", options: ["one"] }] })).toMatchObject({ error: expect.stringContaining("options") });
    expect(validateTemplate({ name: "x", questions: [{ label: "A" }, { label: "a" }] })).toMatchObject({ error: expect.stringContaining("twice") });
    expect(validateTemplate({ name: "x", connectionTypeKey: "Not A Type" })).toMatchObject({ error: expect.stringContaining("connectionTypeKey") });
  });

  it("merges a change onto the current template", () => {
    const current = validateTemplate({ name: "Base", connectionTypeKey: "csv-file", defaults: { requestPolicy: "owner_approval" }, questions: [{ label: "Why", required: true }] }) as ValidTemplate;
    const next = validateTemplate({ name: "Renamed" }, current) as ValidTemplate;
    expect(next).toMatchObject({ name: "Renamed", connection_type_key: "csv-file", defaults: { config: { requestPolicy: "owner_approval" } }, questions: current.questions });
    // Clearing the type also clears what needs one.
    expect(validateTemplate({ connectionTypeKey: null }, { ...current, defaults: { ...current.defaults, config: { entitlementSource: "connector" } } })).toMatchObject({
      error: expect.stringContaining("connection type"),
    });
  });

  it("reads a connection's type from the definition its config names", () => {
    expect(connectionTypeKeyOf({ config: { definition: { key: "workday", version: "1.0.0", origin: "builtin" } } })).toBe("workday");
    expect(connectionTypeKeyOf({ config: {} })).toBeNull();
    expect(connectionTypeKeyOf(null)).toBeNull();
  });

  it("fits only an application of its connection type, or any when it names none", () => {
    expect(templateFits(null, "csv-file")).toBe(true);
    expect(templateFits(null, null)).toBe(true);
    expect(templateFits("csv-file", "csv-file")).toBe(true);
    expect(templateFits("csv-file", "workday")).toBe(false);
    expect(templateFits("csv-file", null)).toBe(false);
  });

  it("checks answers against the questions, and lists the required ones still missing", () => {
    const { questions } = validateTemplate({
      name: "Q",
      questions: [{ label: "Customer data", type: "yes_no", required: true }, { label: "Hosting", type: "choice", options: ["SaaS", "On premises"], required: true }, { label: "Notes" }],
    }) as ValidTemplate;
    expect(missingAnswers(questions, {})).toEqual(["Customer data", "Hosting"]);
    const a = validateAnswers(questions, { customer_data: "no", hosting: "SaaS" });
    expect(a).toEqual({ answers: { customer_data: false, hosting: "SaaS" } });
    // "No" is an answer.
    expect(missingAnswers(questions, (a as { answers: Record<string, string | boolean> }).answers)).toEqual([]);
    expect(validateAnswers(questions, { hosting: "Cloud" })).toMatchObject({ error: expect.stringContaining("one of") });
    expect(validateAnswers(questions, { customer_data: "maybe" })).toMatchObject({ error: expect.stringContaining("yes or no") });
    expect(validateAnswers(questions, { shoe_size: "9" })).toMatchObject({ error: expect.stringContaining("not a question") });
    // An empty answer removes it.
    expect(validateAnswers(questions, { hosting: "" }, { hosting: "SaaS", notes: "x" })).toEqual({ answers: { notes: "x" } });
  });

  it("derives a question key from its label", () => {
    expect(questionKey("  Who approves changes? ")).toBe("who_approves_changes");
    expect(questionKey("2FA required")).toBe("fa_required");
    expect(questionKey("???")).toBe("question");
  });
});
