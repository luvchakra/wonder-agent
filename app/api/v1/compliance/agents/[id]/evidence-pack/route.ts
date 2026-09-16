import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { assembleGovernanceEvidencePack } from "@/modules/certification-compliance/service";
import { exportGovernanceEvidencePack } from "@/modules/operations/service";
import { errorResponse } from "@/modules/certification-compliance/http";
import type { EvidencePackFormat } from "@/lib/shared/types/operations";

/**
 * COMPLIANCE-P0-09 + OPERATIONS-P0-07 — Compliance assembles the per-agent
 * governance evidence pack, Operations turns it into a downloadable file.
 * POST (not GET), matching the campaign-evidence-export precedent
 * (COMPLIANCE-P0-06): producing a tamper-evident export is an audited,
 * security-sensitive action, not a passive read.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("compliance.manage");
    const { id } = await params;
    const pack = await assembleGovernanceEvidencePack(ctx.tenantId!, id);

    const url = new URL(request.url);
    const formatParam = url.searchParams.get("format");
    const format = (formatParam === "csv" || formatParam === "pdf" ? formatParam : "json") as EvidencePackFormat;
    const result = await exportGovernanceEvidencePack(ctx.userId, pack, format);

    if (format === "csv" || format === "pdf") {
      const body = typeof result.content === "string" ? result.content : Buffer.from(result.content);
      return new NextResponse(body, {
        headers: { "Content-Type": result.contentType, "Content-Disposition": `attachment; filename=${result.filename}` },
      });
    }
    return NextResponse.json({ ok: true, data: pack, contentHash: result.contentHash });
  } catch (err) {
    return errorResponse(err);
  }
}
