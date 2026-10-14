/**
 * COMPLIANCE-P0-14 part 3 — consultation, pure (#9). The item's reviewer
 * asks one member a question; that member answers once. Nobody consults
 * themselves; only a pending item takes questions.
 */

export function askRefusal(input: { reviewerId: string; actorId: string; itemStatus: string; askedOf: string | null; question: unknown }): { status: number; code: string; error: string } | null {
  if (input.actorId !== input.reviewerId) return { status: 403, code: "NOT_ASSIGNED_REVIEWER", error: "Only the item's reviewer asks about it" };
  if (input.itemStatus !== "pending") return { status: 409, code: "ITEM_DECIDED", error: "This item is already decided" };
  if (!input.askedOf) return { status: 404, code: "NOT_A_MEMBER", error: "askedOf: an active member of this organization" };
  if (input.askedOf === input.actorId) return { status: 400, code: "SELF", error: "Ask someone else" };
  const q = typeof input.question === "string" ? input.question.trim() : "";
  if (q.length < 3 || q.length > 2000) return { status: 400, code: "VALIDATION_FAILED", error: "question: 3 to 2000 characters" };
  return null;
}

export function answerRefusal(input: { askedOf: string; actorId: string; answeredAt: string | null; answer: unknown }): { status: number; code: string; error: string } | null {
  // Someone else's question is not found, not forbidden: it names nothing.
  if (input.actorId !== input.askedOf) return { status: 404, code: "NOT_FOUND", error: "No such question" };
  if (input.answeredAt) return { status: 409, code: "ALREADY_ANSWERED", error: "Already answered" };
  const a = typeof input.answer === "string" ? input.answer.trim() : "";
  if (a.length < 1 || a.length > 2000) return { status: 400, code: "VALIDATION_FAILED", error: "answer: 1 to 2000 characters" };
  return null;
}
