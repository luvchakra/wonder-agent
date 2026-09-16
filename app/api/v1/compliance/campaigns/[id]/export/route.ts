import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { exportCampaignEvidence } from "@/modules/certification-compliance/service";
import { exportCampaignEvidencePackage } from "@/modules/operations/service";
import { errorResponse } from "@/modules/certification-compliance/http";

/**
 * COMPLIANCE-P0-06 — tamper-evident evidence export package for a
 * campaign. Defaults to the JSON package (unchanged response shape);
 * `?format=csv` turns it into a downloadable file via Operations'
 * `exportCampaignEvidencePackage()`, closing this story's previously-open
 * "actual export file/delivery mechanism" gap now that the
 * Compliance-vs-Operations ownership question is resolved
 * (COMPLIANCE-P0-09/OPERATIONS-P0-07).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("compliance.manage");
    const { id } = await params;
    const pkg = await exportCampaignEvidence(ctx.tenantId!, ctx.userId, id);

    const url = new URL(request.url);
    if (url.searchParams.get("format") === "csv") {
      const result = exportCampaignEvidencePackage(pkg, "csv");
      return new NextResponse(result.content as string, {
        headers: { "Content-Type": result.contentType, "Content-Disposition": `attachment; filename=${result.filename}` },
      });
    }
    return NextResponse.json({ ok: true, data: pkg });
  } catch (err) {
    return errorResponse(err);
  }
}
