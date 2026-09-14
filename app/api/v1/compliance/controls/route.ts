import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listControlFrameworks, listControls } from "@/modules/certification-compliance/service";
import { errorResponse } from "@/modules/certification-compliance/http";

export async function GET(request: NextRequest) {
  try {
    await requirePermission("compliance.read");
    const frameworkId = request.nextUrl.searchParams.get("frameworkId");
    if (frameworkId) {
      const controls = await listControls(frameworkId);
      return NextResponse.json({ ok: true, data: controls });
    }
    const frameworks = await listControlFrameworks();
    return NextResponse.json({ ok: true, data: frameworks });
  } catch (err) {
    return errorResponse(err);
  }
}
