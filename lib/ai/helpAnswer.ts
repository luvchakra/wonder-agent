import "server-only";

import { GUIDE_SECTIONS, type GuideSection } from "@/modules/ui/help/content";
import { resolveAiProviderKey } from "@/modules/platform-admin/service";
import { callAiProvider } from "./provider";

/**
 * The user-guide assistant behind `/help`.
 *
 * Retrieval is deterministic and runs first: the question is scored against
 * the guide sections in `modules/ui/help/content.ts`, and those matches —
 * not the model — are what produce the links shown to the user. An LLM, when
 * one is configured, only phrases an answer grounded in the sections that
 * retrieval already chose.
 *
 * Two properties fall out of that ordering, both deliberate:
 * - The assistant cannot invent a link or cite a page that does not exist,
 *   because it never chooses links at all.
 * - It still works with no AI provider configured, returning the matching
 *   sections and their summaries. AI improves the phrasing; it is not load
 *   bearing (same posture as every other AI feature here — advisory only,
 *   never a decision, non-negotiable #9).
 */

export type HelpAnswer = {
  answer: string;
  /** Always populated from retrieval, never from the model. */
  sections: { id: string; title: string; category: string; href: string }[];
  /** "ai" when a model phrased the answer, "guide" when it is retrieval only. */
  source: "ai" | "guide";
};

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "do", "does", "for", "from",
  "how", "i", "if", "in", "is", "it", "its", "me", "my", "of", "on", "or", "our", "that", "the",
  "their", "them", "then", "there", "these", "this", "to", "we", "what", "when", "where", "which",
  "who", "why", "will", "with", "you", "your",
]);

/** Lowercase word tokens, stopwords dropped, trivial plural stripped. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map((t) => (t.length > 4 && t.endsWith("s") ? t.slice(0, -1) : t));
}

function countHits(haystack: string[], term: string): number {
  return haystack.filter((t) => t === term || t.startsWith(term) || term.startsWith(t)).length;
}

type Scored = { section: GuideSection; score: number };

/**
 * Deterministic scoring — exported so it is unit-testable without any
 * network or provider. Weighted by where a term matches: a hit in the
 * title or in the section's curated keywords is worth far more than one
 * buried in body prose, so "how do I reset my password" reaches the
 * sign-in section rather than every page that happens to say "password".
 */
export function retrieveSections(question: string, limit = 3): GuideSection[] {
  const terms = tokenize(question);
  if (terms.length === 0) return [];

  const scored: Scored[] = GUIDE_SECTIONS.map((section) => {
    const title = tokenize(section.title);
    const keywords = tokenize(section.keywords.join(" "));
    const summary = tokenize(section.summary);
    const body = tokenize(section.body.join(" "));

    let score = 0;
    for (const term of terms) {
      score += countHits(title, term) * 6;
      score += countHits(keywords, term) * 5;
      score += countHits(summary, term) * 2;
      score += Math.min(countHits(body, term), 3); // cap so a long section can't win on length alone
    }

    // Whole-phrase mention is a strong signal ("rogue agent", "effective access").
    const q = question.toLowerCase().trim();
    if (q.length > 6) {
      if (section.title.toLowerCase().includes(q)) score += 12;
      if (section.keywords.some((k) => k.toLowerCase() === q)) score += 10;
    }

    return { section, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.section);
}

function toLinks(sections: GuideSection[]): HelpAnswer["sections"] {
  return sections.map((s) => ({ id: s.id, title: s.title, category: s.category, href: `/help#${s.id}` }));
}

/**
 * Retrieval-only answer, no model call. Used both as `answerHelpQuestion`'s
 * fallback (no provider configured, or the provider call failed) and as
 * the entire answer for an anonymous caller (`/help` is public, but an
 * unauthenticated endpoint calling a paid AI provider on every request is
 * an abuse/cost vector with no tenant to attribute or rate-limit it to —
 * see app/api/v1/help/ask/route.ts). Exported so both call sites share
 * exactly the same "guide does not cover it" copy.
 */
export function guideOnlyAnswer(question: string): HelpAnswer {
  const sections = retrieveSections(question);
  if (sections.length === 0) {
    return {
      answer:
        "I couldn't find anything in the user guide for that. Try rephrasing it, or browse the sections below — " +
        "the guide covers getting started, the SHOULD/CAN/DID model, agents, integrations, access, runtime, risk, " +
        "certification, and settings.",
      sections: [],
      source: "guide",
    };
  }
  // Only the best match's summary — concatenating all three read as three
  // unrelated sentences stapled together; the other matches are already
  // offered as links beside the answer.
  return { answer: sections[0].summary, sections: toLinks(sections), source: "guide" };
}

const SYSTEM_PROMPT =
  "You answer questions about the WonderAgent product using ONLY the documentation excerpts provided in the " +
  "user message. Never state anything the excerpts do not support, and never invent features, screens, URLs or " +
  "links — the interface adds the section links itself, so do not write any. If the excerpts do not answer the " +
  "question, say plainly that the guide does not cover it and point to the closest excerpt topic instead of " +
  "guessing. Answer in at most four sentences of plain prose, addressed to the user.";

function buildPrompt(question: string, sections: GuideSection[]): string {
  const excerpts = sections
    .map((s) => `## ${s.title} (${s.category})\n${s.summary}\n${s.body.join("\n")}`)
    .join("\n\n");
  return `Question: ${question}\n\nDocumentation excerpts:\n\n${excerpts}`;
}

/**
 * `tenantId` is the server-resolved tenant context (never client-supplied),
 * used only to resolve which AI provider/key applies — the guide content
 * itself is the same product documentation for every tenant and contains
 * no customer data, so nothing tenant-scoped is ever sent to a provider.
 */
export async function answerHelpQuestion(tenantId: string, question: string): Promise<HelpAnswer> {
  const guideAnswer = guideOnlyAnswer(question);
  if (guideAnswer.sections.length === 0) return guideAnswer;

  let resolved = null;
  try {
    resolved = await resolveAiProviderKey(tenantId);
  } catch {
    resolved = null;
  }
  if (!resolved) return guideAnswer;

  try {
    const sections = retrieveSections(question);
    const answer = await callAiProvider(resolved, {
      system: SYSTEM_PROMPT,
      user: buildPrompt(question, sections),
      maxTokens: 300,
    });
    return { answer, sections: toLinks(sections), source: "ai" };
  } catch {
    // A provider outage degrades to the guide answer rather than an error —
    // the user still gets the right sections.
    return guideAnswer;
  }
}
