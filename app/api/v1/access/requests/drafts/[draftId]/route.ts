import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { deleteRequestDraft, saveRequestDraft } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

// ACCESS-P0-38 part 2 — one of the caller's own drafts; anyone else's is not found.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ draftId: string }> }) {
  try {
    const ctx = await requirePermission("access.request");
    const { draftId } = await params;
    const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    return NextResponse.json({ ok: true, data: await saveRequestDraft(ctx.tenantId!, ctx.userId, body, draftId) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ draftId: string }> }) {
  try {
    const ctx = await requirePermission("access.request");
    const { draftId } = await params;
    await deleteRequestDraft(ctx.tenantId!, ctx.userId, draftId);
    return NextResponse.json({ ok: true, data: null });
  } catch (err) {
    return errorResponse(err);
  }
}
