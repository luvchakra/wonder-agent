// @vitest-environment node
import { describe, expect, it } from "vitest";
import { summarize, AiNotConfiguredError } from "./summarize";
import * as summarizeModule from "./summarize";
import * as fs from "node:fs";
import * as path from "node:path";

describe("summarize — FOUNDATION-P0-16", () => {
  it("throws AiNotConfiguredError rather than returning a fake/empty summary when no provider is configured", async () => {
    await expect(summarize({ kind: "finding", data: { id: "f1" } })).rejects.toThrow(AiNotConfiguredError);
  });

  it("never resolves — a caller can rely on catch(), never on a falsy/empty success value", async () => {
    const result = await summarize({ kind: "evidence_bundle", data: {} }).catch((err) => err);
    expect(result).toBeInstanceOf(AiNotConfiguredError);
  });

  it("exposes no database client — this module cannot query anything itself (boundary enforced by absence, not by a runtime check)", () => {
    const source = fs.readFileSync(path.join(__dirname, "summarize.ts"), "utf-8");
    expect(source).not.toMatch(/supabaseServer|supabaseServiceRole|supabaseBrowser/);
  });

  it("exports only a function returning prose (AiSummaryResult.summary: string) — never a structured/parseable decision value", () => {
    expect(Object.keys(summarizeModule).sort()).toEqual(["AiNotConfiguredError", "summarize"]);
  });
});
