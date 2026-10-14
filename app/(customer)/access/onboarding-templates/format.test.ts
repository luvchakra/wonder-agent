import { describe, expect, it } from "vitest";
import { parseQuestions, questionsText } from "./format";

describe("questionnaire lines (ACCESS-P0-34)", () => {
  it("reads required marks, yes/no and choices", () => {
    expect(parseQuestions("Who uses it? *\n\nCustomer data (yes/no) *\nHosting [SaaS | On premises]")).toEqual([
      { label: "Who uses it?", type: "text", required: true },
      { label: "Customer data", type: "yes_no", required: true },
      { label: "Hosting", type: "choice", options: ["SaaS", "On premises"], required: false },
    ]);
  });

  it("writes the same lines back", () => {
    const text = "Who uses it? *\nCustomer data (yes/no) *\nHosting [SaaS | On premises]";
    const questions = parseQuestions(text).map((q, i) => ({ key: `q${i}`, ...q }) as Parameters<typeof questionsText>[0][number]);
    expect(questionsText(questions)).toBe(text);
  });
});
