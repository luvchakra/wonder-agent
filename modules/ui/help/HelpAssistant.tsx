"use client";

import { useRef, useState } from "react";
import { Sparkles, CornerDownLeft } from "lucide-react";
import { Button } from "../Button";

type Turn = {
  question: string;
  answer: string;
  sections: { id: string; title: string; category: string; href: string }[];
  /** "guide" means retrieval only — no AI provider configured, or it failed. */
  source: "ai" | "guide";
};

const SUGGESTIONS = [
  "How do I connect Saviynt?",
  "Why do I have no findings?",
  "What is the difference between CAN and DID?",
  "How do I reset my password?",
];

/**
 * Ask-the-guide assistant on `/help`.
 *
 * Answers come from `POST /api/v1/help/ask`, which retrieves matching guide
 * sections deterministically and only then (optionally) has a model phrase
 * them. The links rendered below each answer are those retrieved sections —
 * they cannot be hallucinated, because the model never chooses them.
 *
 * Works with no AI provider configured: the endpoint falls back to the
 * sections' own summaries and marks the answer `source: "guide"`, which is
 * disclosed in the UI rather than passed off as a generated answer.
 */
export function HelpAssistant() {
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function ask(q: string) {
    const trimmed = q.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/help/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.error?.message ?? "Couldn't answer that right now.");
        return;
      }
      setTurns((prev) => [...prev, { question: trimmed, ...json.data }]);
      setQuestion("");
    } catch {
      setError("Couldn't reach the help assistant.");
    } finally {
      setPending(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Sparkles className="size-4" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-foreground">Ask the guide</h2>
          <p className="text-xs text-muted-foreground">
            Answers come from this guide, with a link to the section they came from.
          </p>
        </div>
      </div>

      {turns.length > 0 && (
        <ol aria-label="Assistant answers" className="mt-4 space-y-4">
          {turns.map((turn, i) => (
            <li key={i} className="space-y-2">
              <p className="text-sm font-medium text-foreground">{turn.question}</p>
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
                <p className="text-sm text-foreground">{turn.answer}</p>
                {turn.sections.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-xs text-muted-foreground">In this guide:</span>
                    {turn.sections.map((s) => (
                      <a
                        key={s.id}
                        href={s.href}
                        className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                      >
                        {s.title}
                      </a>
                    ))}
                  </div>
                )}
                {turn.source === "guide" && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Answered straight from the guide text — no AI provider is configured for this
                    workspace.
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
        className="mt-4 flex gap-2"
      >
        <label htmlFor="help-question" className="sr-only">
          Ask a question about WonderAgent
        </label>
        <div className="relative flex-1">
          <input
            id="help-question"
            ref={inputRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask a question about WonderAgent…"
            className="block h-10 w-full rounded-md border border-input bg-background px-3 pr-9 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          />
          <CornerDownLeft
            className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
        </div>
        <Button type="submit" disabled={pending || question.trim().length === 0}>
          {pending ? "Asking…" : "Ask"}
        </Button>
      </form>

      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {turns.length === 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => void ask(s)}
              disabled={pending}
              className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
