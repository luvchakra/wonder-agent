import "server-only";

import type { ResolvedAiProviderKey } from "@/lib/shared/types/platform";

/**
 * The single place that actually talks to an LLM provider.
 *
 * Extracted from `lib/ai/summarize.ts` when a second caller appeared (the
 * help assistant, `lib/ai/helpAnswer.ts`) so the OpenAI/Gemini request
 * shapes, error handling and empty-response handling exist once. Callers
 * supply the prompts and own their own boundaries; this module only knows
 * how to send a system+user prompt to whichever provider was resolved.
 *
 * Deliberately has no Supabase import and no key lookup of its own — the
 * caller resolves the key and passes it in.
 */

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const GEMINI_GENERATE_CONTENT_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export type AiPrompt = {
  system: string;
  user: string;
  /** Upper bound on the reply; callers keep these short deliberately. */
  maxTokens?: number;
  temperature?: number;
};

async function callOpenAi(resolved: ResolvedAiProviderKey, prompt: AiPrompt): Promise<string> {
  const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resolved.apiKey}`,
    },
    body: JSON.stringify({
      model: resolved.model,
      temperature: prompt.temperature ?? 0.2,
      max_tokens: prompt.maxTokens ?? 400,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`OpenAI request failed (${response.status}): ${detail.slice(0, 500)}`);
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("OpenAI response contained no summary content");
  }
  return content;
}

async function callGemini(resolved: ResolvedAiProviderKey, prompt: AiPrompt): Promise<string> {
  const url = `${GEMINI_GENERATE_CONTENT_URL}/${encodeURIComponent(resolved.model)}:generateContent?key=${encodeURIComponent(resolved.apiKey)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: prompt.system }] },
      contents: [{ role: "user", parts: [{ text: prompt.user }] }],
      generationConfig: {
        temperature: prompt.temperature ?? 0.2,
        maxOutputTokens: prompt.maxTokens ?? 400,
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Gemini request failed (${response.status}): ${detail.slice(0, 500)}`);
  }

  const payload = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const content = payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
  if (!content) {
    throw new Error("Gemini response contained no summary content");
  }
  return content;
}

/** Sends one prompt to the resolved provider and returns its prose reply. */
export async function callAiProvider(resolved: ResolvedAiProviderKey, prompt: AiPrompt): Promise<string> {
  return resolved.provider === "gemini" ? callGemini(resolved, prompt) : callOpenAi(resolved, prompt);
}
