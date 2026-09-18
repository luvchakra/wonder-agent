import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant/getTenantContext";
import { answerHelpQuestion } from "@/lib/ai/helpAnswer";

/**
 * The `/help` assistant's endpoint.
 *
 * Requires a session (it is mounted inside the authenticated app) but needs
 * no module permission: the guide is product documentation, identical for
 * every tenant, containing no customer data. Tenant context is resolved
 * anyway because it decides which AI provider key applies.
 *
 * Never 501s the way `/api/v1/ai/summarize` does when no provider is
 * configured — the assistant falls back to deterministic retrieval and
 * still returns the right guide sections.
 */
const MAX_QUESTION_CHARS = 500;

export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx.tenantId) {
    return NextResponse.json(
      { ok: false, error: { code: "NO_TENANT", message: "No active tenant membership" } },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_INPUT", message: "Malformed JSON body" } },
      { status: 400 },
    );
  }

  const { question } = (body ?? {}) as { question?: unknown };
  if (typeof question !== "string" || question.trim().length === 0) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_INPUT", message: "question is required" } },
      { status: 400 },
    );
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_INPUT", message: "question is too long" } },
      { status: 400 },
    );
  }

  try {
    const result = await answerHelpQuestion(ctx.tenantId, question.trim());
    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    console.error("Help assistant failed", err);
    return NextResponse.json(
      { ok: false, error: { code: "INTERNAL_ERROR", message: "Couldn't answer that right now." } },
      { status: 500 },
    );
  }
}
