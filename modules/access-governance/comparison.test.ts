// @vitest-environment node
import { describe, expect, it } from "vitest";
import { classificationsOverlap, classifyAccessGrant } from "./comparison";

describe("classificationsOverlap — ACCESS-P0-04", () => {
  it("matches when the classification code is a substring of the free-text vocabulary term", () => {
    expect(classificationsOverlap("financial reporting data", "financial")).toBe(true);
  });

  it("matches when the vocabulary term is a substring of the classification code", () => {
    expect(classificationsOverlap("pii", "pii-restricted")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(classificationsOverlap("Financial Reporting Data", "FINANCIAL")).toBe(true);
  });

  it("does not match unrelated terms", () => {
    expect(classificationsOverlap("financial reporting data", "hr-confidential")).toBe(false);
  });

  it("does not match on empty strings", () => {
    expect(classificationsOverlap("", "financial")).toBe(false);
    expect(classificationsOverlap("financial", "")).toBe(false);
  });
});

describe("classifyAccessGrant — ACCESS-P0-04", () => {
  // Mirrors the live FinanceBot fixture (tenant aaaaaaaa-5000-...) exactly:
  // approvedApplications ["SAP","Snowflake"], approvedData ["financial
  // reporting"], prohibitedData [] — verified live via Supabase MCP against
  // the real fixture rows before writing this test.
  const financeBotContract = {
    approvedApplications: ["SAP", "Snowflake"],
    approvedData: ["financial reporting"],
    prohibitedData: [] as string[],
  };

  it("classifies in-scope data on an approved application as approved (Financial_Reporting_READ)", () => {
    expect(
      classifyAccessGrant(financeBotContract, { application: "Snowflake", dataClassification: "financial" }),
    ).toBe("approved");
  });

  it("classifies out-of-scope data on an otherwise-approved application as excessive — the CLAUDE.md §11 central case (CustomerDB_READ)", () => {
    expect(
      classifyAccessGrant(financeBotContract, { application: "Snowflake", dataClassification: "pii" }),
    ).toBe("excessive");
  });

  it("classifies in-scope data on the other approved application as approved (SAP_READ)", () => {
    expect(classifyAccessGrant(financeBotContract, { application: "SAP", dataClassification: "financial" })).toBe(
      "approved",
    );
  });

  it("classifies any grant on an unapproved application as excessive", () => {
    expect(
      classifyAccessGrant(financeBotContract, { application: "Workday", dataClassification: "financial" }),
    ).toBe("excessive");
  });

  it("classifies a grant with no application reference as unknown", () => {
    expect(classifyAccessGrant(financeBotContract, { application: null, dataClassification: "financial" })).toBe(
      "unknown",
    );
  });

  it("treats an approved application with no declared data classification as approved when the contract has no data-level restriction and the grant carries none", () => {
    const openContract = { approvedApplications: ["SAP"], approvedData: [] as string[], prohibitedData: [] as string[] };
    expect(classifyAccessGrant(openContract, { application: "SAP", dataClassification: null })).toBe("approved");
  });

  it("treats explicitly prohibited data as excessive even on an approved application with no approvedData restriction", () => {
    const contract = { approvedApplications: ["SAP"], approvedData: [] as string[], prohibitedData: ["pii"] };
    expect(classifyAccessGrant(contract, { application: "SAP", dataClassification: "pii" })).toBe("excessive");
  });
});
