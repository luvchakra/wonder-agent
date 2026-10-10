import { INSTALL_PROMPT_CAPTURE_SCRIPT } from "./prompt";

/**
 * EXPERIENCE-P0-26 — rendered in the root layout's <head>, beside
 * ThemeFlashGuard, so Chromium's `beforeinstallprompt` is caught even when
 * it fires before React hydrates (see prompt.ts).
 */
export function InstallPromptCapture() {
  return <script dangerouslySetInnerHTML={{ __html: INSTALL_PROMPT_CAPTURE_SCRIPT }} />;
}
