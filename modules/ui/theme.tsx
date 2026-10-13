"use client";

import { useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

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

const OPTIONS = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;

export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>(readStoredChoice);

  function handleChange(next: ThemeChoice) {
    setChoice(next);
    applyTheme(next);
  }

  // A compact segmented control (owner, 2026-10-13: the text buttons overflowed the account menu):
  // icons with names for screen readers and tooltips, the current choice raised on a muted track.
  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-muted p-0.5">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={choice === value}
          aria-label={label}
          title={label}
          onClick={() => handleChange(value)}
          className={`flex size-7 items-center justify-center rounded-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${
            choice === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Icon className="size-3.5" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
