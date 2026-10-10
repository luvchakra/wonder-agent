import { INSTALL_SNOOZE_MS, INSTALL_STORAGE_KEY, parseInstallMemory, type InstallMemory } from "./eligibility";

/**
 * EXPERIENCE-P0-26 — the browser side of the install banner: the held
 * `beforeinstallprompt` event and what this browser remembers.
 *
 * Chromium can fire `beforeinstallprompt` before React hydrates, so a tiny
 * inline script in the root layout's <head> (INSTALL_PROMPT_CAPTURE_SCRIPT,
 * the same pattern as ThemeFlashGuard; the CSP allows inline scripts)
 * catches it, calls preventDefault() and parks it on `window`. The banner
 * reads it from there through `subscribeInstallPrompt`.
 */

export type BeforeInstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
};

declare global {
  interface Window {
    __wonderidInstallPrompt?: BeforeInstallPromptEvent | null;
  }
}

/** Fired on `window` whenever the held prompt or the installed state changes. */
export const INSTALL_PROMPT_CHANGED = "wonderid:installprompt";

/** Runs in <head> before hydration. No user or tenant data; storage failures are swallowed. */
export const INSTALL_PROMPT_CAPTURE_SCRIPT = `(function(){try{var w=window;w.addEventListener('beforeinstallprompt',function(e){e.preventDefault();w.__wonderidInstallPrompt=e;w.dispatchEvent(new Event('${INSTALL_PROMPT_CHANGED}'))});w.addEventListener('appinstalled',function(){w.__wonderidInstallPrompt=null;try{localStorage.setItem('${INSTALL_STORAGE_KEY}','{"state":"installed"}')}catch(_){}w.dispatchEvent(new Event('${INSTALL_PROMPT_CHANGED}'))})}catch(_){}})();`;

export function heldInstallPrompt(): BeforeInstallPromptEvent | null {
  return typeof window === "undefined" ? null : (window.__wonderidInstallPrompt ?? null);
}

export function clearInstallPrompt() {
  if (typeof window !== "undefined") window.__wonderidInstallPrompt = null;
}

let version = 0;

/**
 * useSyncExternalStore subscription. Also catches `beforeinstallprompt`
 * itself, in case the head script did not run (a test, or an old cached
 * document).
 */
export function subscribeInstallPrompt(onChange: () => void): () => void {
  const bump = () => {
    version += 1;
    onChange();
  };
  const onPrompt = (e: Event) => {
    e.preventDefault();
    window.__wonderidInstallPrompt = e as BeforeInstallPromptEvent;
    bump();
  };
  const onInstalled = () => {
    window.__wonderidInstallPrompt = null;
    rememberInstalled();
    bump();
  };
  window.addEventListener(INSTALL_PROMPT_CHANGED, bump);
  window.addEventListener("beforeinstallprompt", onPrompt);
  window.addEventListener("appinstalled", onInstalled);
  return () => {
    window.removeEventListener(INSTALL_PROMPT_CHANGED, bump);
    window.removeEventListener("beforeinstallprompt", onPrompt);
    window.removeEventListener("appinstalled", onInstalled);
  };
}

/** Client snapshot: changes whenever the held prompt or installed state does. */
export function installPromptVersion(): number {
  return version;
}

export function readInstallMemory(): InstallMemory | null {
  try {
    return parseInstallMemory(window.localStorage.getItem(INSTALL_STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeInstallMemory(memory: InstallMemory) {
  try {
    window.localStorage.setItem(INSTALL_STORAGE_KEY, JSON.stringify(memory));
  } catch {
    // Blocked storage: the banner simply may come back next visit.
  }
}

export function rememberInstalled() {
  writeInstallMemory({ state: "installed" });
}

export function snoozeInstallBanner(now: number) {
  writeInstallMemory({ state: "snoozed", until: now + INSTALL_SNOOZE_MS });
}

const INSTALLED_DISPLAY_MODES = ["standalone", "fullscreen", "minimal-ui", "window-controls-overlay"];

/** Running as the installed app rather than in a browser tab. */
export function isRunningInstalled(): boolean {
  if ((window.navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
  if (typeof window.matchMedia !== "function") return false;
  return INSTALLED_DISPLAY_MODES.some((m) => window.matchMedia(`(display-mode: ${m})`).matches);
}
