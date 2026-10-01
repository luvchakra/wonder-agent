import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/rbac/requirePlatformAdmin";
import { errorResponse } from "@/modules/platform-admin/http";
import { assertOneOf, assertPlainObject, assertUuid } from "@/lib/security/validate";
import { decideAdjustment } from "@/modules/billing/adjustments";

/** Checker step: a different platform administrator approves (and it executes) or rejects. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await requirePlatformAdmin();
    const { id } = await params;
    const body = assertPlainObject(await request.json().catch(() => null), "body");
    const decision = assertOneOf(body.decision, ["approve", "reject"] as const, "decision");
    const adj = await decideAdjustment(userId, assertUuid(id, "id"), decision === "approve", typeof body.note === "string" ? body.note.slice(0, 2000) : null);
    return NextResponse.json({ ok: true, data: adj });
  } catch (err) {
    return errorResponse(err);
  }
}
