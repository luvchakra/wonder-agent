import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant/getTenantContext";
import { summarize, AiNotConfiguredError } from "@/lib/ai/summarize";
import type { AiSummaryKind } from "@/lib/shared/types/ai";

/**
 * EXPERIENCE-P0-14 — the one route wrapping Foundation's `lib/ai/summarize`
 * primitive (FOUNDATION-P0-16). Pure passthrough: no domain logic of its
 * own, so it carries no module-specific business rules beyond authorizing
 * the caller to view the *kind* of data being summarized — the same
 * `risk.read`/`runtime.read`/`compliance.read` gates those domains'
 * existing routes already require, since a summary of data the caller
 * couldn't otherwise see would leak it. Added under Foundation's `lib/ai/`
 * umbrella (not modifying that file itself — non-negotiable #18) because
 * it was this story's direct blocking dependency; see the Experience Agent
 * audit log's 2026-09-16 entry.
 */
const REQUIRED_PERMISSION: Record<AiSummaryKind, string> = {
  finding: "risk.read",
  evidence_bundle: "compliance.read",
  should_can_did_comparison: "runtime.read",
  certification_item: "compliance.read",
};

const MAX_PAYLOAD_CHARS = 50_000;

export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx.tenantId) {
    return NextResponse.json({ ok: false, error: { code: "NO_TENANT", message: "No active tenant membership" } }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: { code: "INVALID_INPUT", message: "Malformed JSON body" } }, { status: 400 });
  }

  const { kind, data } = (body ?? {}) as { kind?: string; data?: unknown };
  if (!kind || !(kind in REQUIRED_PERMISSION)) {
    return NextResponse.json({ ok: false, error: { code: "INVALID_INPUT", message: "Unknown summary kind" } }, { status: 400 });
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return NextResponse.json({ ok: false, error: { code: "INVALID_INPUT", message: "data is required" } }, { status: 400 });
  }
  if (JSON.stringify(data).length > MAX_PAYLOAD_CHARS) {
    return NextResponse.json({ ok: false, error: { code: "INVALID_INPUT", message: "data payload too large" } }, { status: 400 });
  }

  const permission = REQUIRED_PERMISSION[kind as AiSummaryKind];
  if (!ctx.permissions.includes(permission)) {
    return NextResponse.json({ ok: false, error: { code: "FORBIDDEN", message: `Missing permission: ${permission}` } }, { status: 403 });
  }

  try {
    const result = await summarize(ctx.tenantId!, { kind: kind as AiSummaryKind, data: data as Record<string, unknown> });
    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    if (err instanceof AiNotConfiguredError) {
      return NextResponse.json({ ok: false, error: { code: "AI_NOT_CONFIGURED", message: err.message } }, { status: 501 });
    }
    console.error("AI summarize route failed", err);
    return NextResponse.json({ ok: false, error: { code: "INTERNAL_ERROR", message: "Failed to generate summary" } }, { status: 500 });
  }
}
