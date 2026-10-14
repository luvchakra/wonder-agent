import type { OnboardingQuestion } from "@/lib/shared/types/access-governance";

// ACCESS-P0-34 — the questionnaire as lines of text, both ways.

/** One question per line: "*" at the end makes it required; "(yes/no)" or "[A | B]" makes it a choice. */
export function parseQuestions(text: string): Partial<OnboardingQuestion>[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      let label = line;
      const required = /\*\s*$/.test(label);
      label = label.replace(/\*\s*$/, "").trim();
      const choice = label.match(/\[([^\]]+)\]\s*$/);
      if (choice) return { label: label.slice(0, choice.index).trim(), type: "choice" as const, options: choice[1].split("|").map((o) => o.trim()), required };
      if (/\(yes\/no\)\s*$/i.test(label)) return { label: label.replace(/\(yes\/no\)\s*$/i, "").trim(), type: "yes_no" as const, required };
      return { label, type: "text" as const, required };
    });
}

export function questionsText(questions: OnboardingQuestion[]): string {
  return questions.map((q) => `${q.label}${q.type === "yes_no" ? " (yes/no)" : q.type === "choice" ? ` [${(q.options ?? []).join(" | ")}]` : ""}${q.required ? " *" : ""}`).join("\n");
}
