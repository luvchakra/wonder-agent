import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant/getTenantContext";
import { answerHelpQuestion, guideOnlyAnswer } from "@/lib/ai/helpAnswer";

/**
 * The `/help` assistant's endpoint. Needs no module permission and no
 * session: `/help` is public (2026-09-18, proxy.ts) and the guide is
 * product documentation, identical for every visitor, containing no
 * customer data.
 *
 * Tenant context is resolved only to decide which AI provider key applies
 * — a signed-in caller with a tenant gets that tenant's configured
 * provider (or the platform default) if one exists, same as before. A
 * caller with no tenant (anonymous, or signed in but not yet onboarded)
 * gets retrieval-only answers, deliberately: an unauthenticated endpoint
 * that can trigger a paid AI provider call, with no tenant to attribute or
 * rate-limit the spend to, is an abuse/cost vector. The design already
 * degrades to retrieval gracefully (`source: "guide"`), so the public
 * assistant stays fully useful without it.
 *
 * Never 501s the way `/api/v1/ai/summarize` does when no provider is
 * configured — the assistant falls back to deterministic retrieval and
 * still returns the right guide sections.
 */
const MAX_QUESTION_CHARS = 500;

export async function POST(request: Request) {
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
    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    console.error("Help assistant failed", err);
    return NextResponse.json(
      { ok: false, error: { code: "INTERNAL_ERROR", message: "Couldn't answer that right now." } },
      { status: 500 },
    );
  }
}
