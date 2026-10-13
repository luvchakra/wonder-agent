/**
 * RISK-P0-13 — pure, deterministic severity for rogue access (#9): how bad
 * a piece of access nobody approved is, from facts WonderID holds about it.
 * No model, no guess: every point comes from a named factor, and the
 * factors are written on the finding as its reasons.
 */
import type { RiskSeverity } from "@/lib/shared/types/risk";

export type RogueFacts = {
  /** The entitlement's privilege level (null: access to the account itself). */
  privilegeLevel: "standard" | "elevated" | "admin" | null;
  /** The account's type on the target. */
  accountType: "standard" | "privileged" | "service" | "shared" | null;
  /** The data the entitlement reaches, as classified (free text). */
  dataClassification: string | null;
  /** The identity the account belongs to (null: linked to nobody). */
  identityType: string | null;
  identityStatus: string | null;
  /** Other rogue access on the same account (not counting this one). */
  otherRogueOnAccount: number;
};

/** Classifications that mark sensitive data (case-insensitive, any part of the label). */
const SENSITIVE = /restricted|confidential|secret|sensitive|pii|phi|pci|financial|regulated/i;
const INACTIVE = new Set(["inactive", "disabled", "terminated", "archived"]);

/** Every rogue finding starts here: access nobody approved, appearing after the baseline. */
export const ROGUE_BASE_SCORE = 50;

export type RogueSeverity = { severity: RiskSeverity; score: number; reasons: string[] };

export function rogueSeverity(f: RogueFacts): RogueSeverity {
  const reasons = ["Appeared after the application's baseline", "No WonderID approval found"];
  let score = ROGUE_BASE_SCORE;
  const add = (points: number, reason: string) => {
    score += points;
    reasons.push(reason);
  };

  if (f.privilegeLevel === "admin") add(25, "Administrative privilege");
  else if (f.privilegeLevel === "elevated") add(15, "Elevated privilege");
  if (f.accountType === "privileged" || f.accountType === "shared") add(10, f.accountType === "privileged" ? "Privileged account" : "Shared account");
  if (f.dataClassification && SENSITIVE.test(f.dataClassification)) add(15, `Reaches ${f.dataClassification.trim()} data`);
  if (f.identityStatus && INACTIVE.has(f.identityStatus)) add(25, `Held by an identity that is ${f.identityStatus}`);
  if (f.identityType === "EXTERNAL") add(10, "Held by an external person");
  if (!f.identityType) add(10, "The account is linked to no identity");
  if (f.otherRogueOnAccount >= 2) add(10, `The account has ${f.otherRogueOnAccount} more pieces of rogue access`);

  score = Math.min(score, 100);
  const severity: RiskSeverity = score >= 85 ? "critical" : score >= 65 ? "high" : score >= 40 ? "medium" : "low";
  return { severity, score, reasons };
}
