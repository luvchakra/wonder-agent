import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant/getTenantContext";
import { getSessionUser } from "@/lib/tenant/session";
import { answerHelpQuestion, guideOnlyAnswer } from "@/lib/ai/helpAnswer";

/**
 * The help assistant's endpoint. Needs a session (owner request,
 * 2026-10-16; it was public from 2026-09-18) but no module permission: the
 * guide is product documentation with no customer data. Without a session
 * it returns 401 and no guide text.
 *
 * Tenant context decides only which AI provider key applies. A caller with
 * an organization gets that organization's configured provider (or the
 * platform default); a caller with none (signed in, not yet onboarded) gets
 * retrieval-only answers (`source: "guide"`), so no provider call is made
 * without an organization to attribute it to.
 *
 * Never 501s when no provider is configured: it falls back to deterministic
 * retrieval and still returns the right guide sections.
 */
const MAX_QUESTION_CHARS = 500;

export async function POST(request: Request) {
  if (!(await getSessionUser())) {
    return NextResponse.json(
      { ok: false, error: { code: "UNAUTHENTICATED", message: "Sign in to use the help assistant" } },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  const ctx = await getTenantContext();

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
    const result = ctx.tenantId
      ? await answerHelpQuestion(ctx.tenantId, question.trim())
      : guideOnlyAnswer(question.trim());
    return NextResponse.json({ ok: true, data: result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    console.error("Help assistant failed", err);
    return NextResponse.json(
      { ok: false, error: { code: "INTERNAL_ERROR", message: "Couldn't answer that right now." } },
      { status: 500 },
    );
  }
}
