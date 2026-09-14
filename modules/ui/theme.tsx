"use client";

import { useState } from "react";

type ThemeChoice = "light" | "dark" | "system";

const STORAGE_KEY = "wonderagent-theme";

/**
 * EXPERIENCE-P0-01.0. Inline, synchronous script rendered before hydration
 * to avoid a flash of the wrong theme — reads localStorage and sets
 * data-theme on <html> before first paint. Deliberately not a React
 * component's effect (that would run after paint).
 */
export function ThemeFlashGuard() {
  const script = `
    try {
      var stored = localStorage.getItem('${STORAGE_KEY}');
      if (stored === 'light' || stored === 'dark') {
        document.documentElement.setAttribute('data-theme', stored);
      }
    } catch (e) {}
  `;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}

function applyTheme(choice: ThemeChoice) {
  if (choice === "system") {
    document.documentElement.removeAttribute("data-theme");
    localStorage.removeItem(STORAGE_KEY);
  } else {
    document.documentElement.setAttribute("data-theme", choice);
    localStorage.setItem(STORAGE_KEY, choice);
  }
}

/** Light/dark/system toggle for the shell's user menu. */
function readStoredChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>(readStoredChoice);

  function handleChange(next: ThemeChoice) {
    setChoice(next);
    applyTheme(next);
  }

  return (
    <div className="flex items-center gap-1 rounded-md border border-border p-0.5 text-xs">
      {(["light", "dark", "system"] as const).map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => handleChange(opt)}
          aria-pressed={choice === opt}
          className={`rounded px-2 py-1 capitalize transition-colors ${
            choice === opt ? "bg-accent text-accent-foreground" : "text-text-secondary hover:text-text-primary"
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}
