import "server-only";

import type {
  ConfidenceLevel,
  DetectionClassification,
  DetectionSignal,
  EvidenceStrength,
} from "@/lib/shared/types/agent-identity";
import type { IntegrationCategory } from "@/lib/shared/types/integrations";

/**
 * Agent Discovery — AI-Agent Detection & Confidence Assessment.
 *
 * Deterministic, rule-based, fully explainable — never an LLM/ML call
 * (CLAUDE.md non-negotiable #9; the discovery spec's own §55 gate item "No
 * new fuzzy/ML correlation engine is introduced in P0"). Every point added
 * to the score is tied to one named, observable signal that is returned
 * alongside the score, so a reviewer can always see *why* an object was
 * classified the way it was (spec §10/§11/§22).
 *
 * Operates only on data already published through Integration Agent's
 * contract (`NormalizedIdentity` + the connector's own `raw` payload) —
 * never queries integration_objects directly and never invents fields the
 * connectors don't actually produce.
 */

type ClassifyInput = {
  sourceName: string;
  sourceCategory?: IntegrationCategory;
  displayName: string;
  normalized: Record<string, unknown>;
  raw: Record<string, unknown>;
};

export type ClassificationResult = {
  classification: DetectionClassification;
  confidenceScore: number;
  confidenceLevel: ConfidenceLevel;
  signals: DetectionSignal[];
};

const AI_IDENTIFIER_KEYS = ["agentid", "botid", "aiagentid", "isagent"];
const AI_PLATFORM_METADATA_KEYS = [
  "agentframework",
  "modelprovider",
  "model",
  "framework",
  "platform",
  "provider",
  "mcpserver",
  "mcp_server",
];
const NAME_PATTERN = /\b(bot|agent|copilot|assistant|automation|pipeline|workflow)\b/i;
const AGENT_TYPE_PATTERN = /agent|bot/i;
const METADATA_TEXT_PATTERN = /\b(ai|agent|bot|automation|llm|gpt|genai)\b/i;

function truthy(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "boolean") return value;
  return true;
}

/** Case-insensitive, top-level-only key lookup — connectors publish flat normalized/raw shapes (see connector.ts). */
function findKey(obj: Record<string, unknown>, keys: string[]): { key: string; value: unknown } | null {
  const lower = new Map(Object.keys(obj).map((k) => [k.toLowerCase(), k]));
  for (const wanted of keys) {
    const actual = lower.get(wanted);
    if (actual !== undefined && truthy(obj[actual])) {
      return { key: actual, value: obj[actual] };
    }
  }
  return null;
}

function describe(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(", ");
  return String(value);
}

export function classifyAgentSignal(input: ClassifyInput): ClassificationResult {
  const { sourceName, sourceCategory, displayName, normalized, raw } = input;
  const signals: DetectionSignal[] = [];
  let score = 0;

  const add = (signal: string, observedValue: string, strength: EvidenceStrength, points: number) => {
    signals.push({ signal, source: sourceName, observedValue, strength, scoreContribution: points });
    score += points;
  };

  if (sourceCategory === "ai_runtime" || sourceCategory === "mcp") {
    add("AI runtime / MCP source", sourceCategory, "strong", 35);
  }

  const idMatch = findKey(raw, AI_IDENTIFIER_KEYS) ?? findKey(normalized, AI_IDENTIFIER_KEYS);
  if (idMatch) {
    add("AI platform identifier", `${idMatch.key} = ${describe(idMatch.value)}`, "strong", 35);
  } else {
    const agentTypeMatch = findKey(raw, ["agenttype", "type"]) ?? findKey(normalized, ["agenttype"]);
    if (agentTypeMatch && AGENT_TYPE_PATTERN.test(String(agentTypeMatch.value))) {
      add("AI platform identifier", `${agentTypeMatch.key} = ${describe(agentTypeMatch.value)}`, "strong", 35);
    }
  }

  const platformMatch = findKey(raw, AI_PLATFORM_METADATA_KEYS) ?? findKey(normalized, AI_PLATFORM_METADATA_KEYS);
  if (platformMatch) {
    add("AI platform metadata", `${platformMatch.key} = ${describe(platformMatch.value)}`, "medium", 20);
  }

  if (NAME_PATTERN.test(displayName)) {
    add("Naming pattern", displayName, "medium", 20);
  }

  const identityType = String(normalized.identityType ?? raw.identityType ?? raw.accountType ?? "");
  if (identityType.toLowerCase() === "service_account") {
    add("Service identity", identityType, "weak", 15);
  }

  const tagsMatch = findKey(raw, ["tags", "labels", "description"]);
  if (tagsMatch && METADATA_TEXT_PATTERN.test(describe(tagsMatch.value))) {
    add("Metadata tags/description", `${tagsMatch.key} = ${describe(tagsMatch.value)}`, "weak", 10);
  }

  const toolsMatch = findKey(raw, ["tools", "mcptools", "toolcount"]);
  if (toolsMatch) {
    add("Tool/relationship association", `${toolsMatch.key} = ${describe(toolsMatch.value)}`, "medium", 15);
  }

  score = Math.min(100, score);

  const hasNoData = Object.keys(raw).length === 0 && Object.keys(normalized).length === 0;
  if (hasNoData) {
    return { classification: "UNKNOWN", confidenceScore: 0, confidenceLevel: "LOW", signals };
  }

  if (score === 0) {
    return { classification: "NON_AGENT", confidenceScore: 0, confidenceLevel: "LOW", signals };
  }

  const hasStrongSignal = signals.some((s) => s.strength === "strong");
  const confidenceLevel: ConfidenceLevel = score >= 80 ? "HIGH" : score >= 50 ? "MEDIUM" : "LOW";

  let classification: DetectionClassification;
  if (hasStrongSignal && confidenceLevel === "HIGH") {
    classification = "CONFIRMED_AGENT";
  } else if (confidenceLevel === "HIGH" || (hasStrongSignal && confidenceLevel === "MEDIUM")) {
    classification = "PROBABLE_AGENT";
  } else {
    classification = "POSSIBLE_AGENT";
  }

  return { classification, confidenceScore: score, confidenceLevel, signals };
}
