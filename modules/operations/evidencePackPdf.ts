import "server-only";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { GovernanceEvidencePack } from "@/lib/shared/types/compliance";

const PAGE_WIDTH = 612; // US Letter, points
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const BODY_SIZE = 10;
const HEADING_SIZE = 13;
const LINE_HEIGHT = 14;

/**
 * OPERATIONS-P0-07 — human-readable rendering of Compliance's
 * GovernanceEvidencePack, for a reviewer/auditor who wants a printable
 * artifact rather than the JSON/CSV formats (already built for
 * machine consumption). Deliberately not a dump of every raw field: one
 * summary line per record, per section, matching the level of detail an
 * auditor scanning an evidence pack actually needs — the JSON export
 * remains the format for anyone who needs the full underlying record.
 */
export async function renderEvidencePackPdf(pack: GovernanceEvidencePack): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  const writer = new PageWriter(doc, font, boldFont);

  writer.heading("Governance Evidence Pack");
  writer.line(`Agent: ${pack.identity.agent.agentName} (${pack.agentId})`);
  writer.line(`Tenant: ${pack.tenantId}`);
  writer.line(`Generated: ${pack.generatedAt}`);
  writer.gap();

  writer.heading("Identity");
  writer.line(`Display name: ${pack.identity.agent.displayName ?? "—"}`);
  writer.line(`Purpose: ${pack.identity.agent.purpose ?? "—"}`);
  writer.line(`Criticality: ${pack.identity.agent.criticality}`);
  writer.line(`Lifecycle contract: ${pack.identity.contract ? pack.identity.contract.id : "none"}`);
  pack.identity.owners.forEach((o) => writer.line(`Owner: ${o.ownerType} — ${o.userId}`));
  pack.identity.lifecycleEvents.forEach((e) => writer.line(`Lifecycle event: ${e.toState} at ${e.createdAt}`));
  writer.gap();

  writer.heading("Effective Access & Policy");
  pack.access.effectiveAccess.forEach((g) => writer.line(`Grant: ${g.application ?? "?"} / ${g.entitlementName ?? "?"} (${g.grantType})`));
  pack.access.policyEvaluations.forEach((e) => writer.line(`Policy evaluation: ${e.policyId} — ${e.result}`));
  pack.access.exceptions.forEach((e) => writer.line(`Exception: ${e.scopeType} — ${e.status} (${e.reason})`));
  writer.gap();

  writer.heading("SHOULD vs CAN vs DID");
  writer.line(`SHOULD: ${pack.shouldCanDid.should.length} approved resource(s)`);
  writer.line(`CAN: ${pack.shouldCanDid.can.length} technically-accessible resource(s)`);
  writer.line(`DID: ${pack.shouldCanDid.did.length} observed-activity resource(s)`);
  pack.shouldCanDid.outcomes.forEach((o) => writer.line(`Outcome: ${o.type}`));
  writer.gap();

  writer.heading("Risk Findings");
  if (pack.risk.findings.length === 0) writer.line("No open findings.");
  pack.risk.findings.forEach((f) => writer.line(`[${f.severity.toUpperCase()}] ${f.title} — ${f.status}`));
  writer.gap();

  writer.heading("Certification Decisions");
  if (pack.certifications.length === 0) writer.line("No certification decisions recorded.");
  pack.certifications.forEach((d) => writer.line(`${d.decision} by ${d.decidedBy} at ${d.decidedAt}`));
  writer.gap();

  writer.heading("Attestations");
  if (pack.attestations.length === 0) writer.line("No attestations recorded.");
  pack.attestations.forEach((a) => writer.line(`${a.policyRequirement}: ${a.decision} by ${a.approverId} (valid from ${a.validFrom})`));
  writer.gap();

  writer.heading("Control Mappings");
  if (pack.controlMappings.length === 0) writer.line("No control mappings recorded.");
  pack.controlMappings.forEach((m) => writer.line(`Control ${m.controlId}: ${m.status}`));
  writer.gap();

  writer.heading("Remediation");
  if (pack.remediation.accessRequests.length === 0) writer.line("No remediation access requests.");
  pack.remediation.accessRequests.forEach((r) => writer.line(`${r.requestType} request — ${r.status} (${r.justification})`));
  writer.gap();

  writer.heading("Governance Posture");
  writer.line(`Status: ${pack.posture.status}`);
  pack.posture.dimensions.forEach((d) => writer.line(`${d.dimension}: ${d.status}`));
  if (pack.posture.coveringExceptionIds.length > 0) writer.line(`Covered by exception(s): ${pack.posture.coveringExceptionIds.join(", ")}`);

  return doc.save();
}

/** Small stateful helper so section-writing calls above stay one line each — paginates automatically when a page fills up. */
class PageWriter {
  private page: PDFPage;
  private y: number;

  constructor(
    private readonly doc: PDFDocument,
    private readonly font: PDFFont,
    private readonly boldFont: PDFFont,
  ) {
    this.page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  private ensureSpace(): void {
    if (this.y < MARGIN + LINE_HEIGHT) {
      this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      this.y = PAGE_HEIGHT - MARGIN;
    }
  }

  heading(text: string): void {
    this.ensureSpace();
    this.page.drawText(text, { x: MARGIN, y: this.y, size: HEADING_SIZE, font: this.boldFont, color: rgb(0, 0, 0) });
    this.y -= LINE_HEIGHT + 4;
  }

  line(text: string): void {
    // pdf-lib's StandardFonts.Helvetica only supports WinAnsi-encodable
    // characters — strip anything outside that range rather than letting
    // an unexpected character (e.g. from free-text justification/reason
    // fields) throw and abort the whole export.
    const safe = text.replace(/[^\x20-\x7E]/g, "?");
    for (const wrapped of wrapText(safe, 95)) {
      this.ensureSpace();
      this.page.drawText(wrapped, { x: MARGIN, y: this.y, size: BODY_SIZE, font: this.font, color: rgb(0.15, 0.15, 0.15) });
      this.y -= LINE_HEIGHT;
    }
  }

  gap(): void {
    this.y -= LINE_HEIGHT / 2;
  }
}

function wrapText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}
