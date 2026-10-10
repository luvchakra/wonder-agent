/**
 * EXPERIENCE-P0-26 — when the "install the app" banner may show. Pure: every
 * browser fact arrives as an argument, so each platform is a unit test
 * (eligibility.test.ts) and the component only gathers the facts.
 *
 * The banner shows only on a phone or tablet, in a normal browser tab, when
 * the browser can install the app and it is not installed on this device:
 * - Chromium-family browsers: only once `beforeinstallprompt` has fired,
 *   which itself means "installable and not installed" → one-tap Install.
 * - iOS / iPadOS: no programmatic install exists, so Safari (and, from iOS
 *   16.4, the other browsers whose share sheet has "Add to Home Screen")
 *   get the two-tap instructions.
 * - Anything else (Firefox on Android, in-app webviews, desktop): nothing.
 */

/** localStorage key, namespaced to this product. Holds no user or tenant data. */
export const INSTALL_STORAGE_KEY = "wonderid-install-banner";
/** Dismissing the banner, or declining the browser's prompt, snoozes it this long. */
export const INSTALL_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

/** What this browser remembers: installed (never again) or snoozed until a time. */
export type InstallMemory = { state: "installed" } | { state: "snoozed"; until: number };

export type InstallBannerVariant = "hidden" | "prompt" | "ios";

/** The page is one the banner may appear on. */
export function isInstallBannerRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  // The vendor console, auth callbacks and redirects, the JSON API, and any
  // print, export or embedded view never get the banner.
  if (/^\/(platform-admin|auth|api)(\/|$)/.test(pathname)) return false;
  if (/\/(print|export|embed)(\/|$)/.test(pathname)) return false;
  return true;
}

/** Phone or tablet. A touchscreen laptop or desktop does not count. */
export function isPhoneOrTablet(input: {
  userAgent: string;
  /** `navigator.userAgentData?.mobile`, where the browser has it. */
  uaDataMobile?: boolean;
  maxTouchPoints: number;
  /** `matchMedia('(pointer: coarse)').matches` — the primary pointer is a finger. */
  coarsePointer: boolean;
}): boolean {
  if (!input.coarsePointer) return false;
  if (input.uaDataMobile === true) return true;
  const ua = input.userAgent;
  if (/Android|iPhone|iPod|iPad/i.test(ua)) return true;
  // iPadOS Safari presents itself as a Mac; a real Mac has no multi-touch screen.
  return /Macintosh/.test(ua) && input.maxTouchPoints > 1;
}

/** iPhone, iPod or iPad (including iPadOS presenting as a Mac). */
export function isAppleMobile(userAgent: string, maxTouchPoints: number): boolean {
  return /iPhone|iPod|iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

/**
 * In-app browsers (social and messaging apps, the Google app, Android
 * WebView). None of them can install a web app, so they get nothing.
 */
export function isInAppBrowser(userAgent: string): boolean {
  return /FBAN|FBAV|FB_IAB|FBIOS|Instagram|LinkedInApp|Line\/|Twitter|MicroMessenger|Snapchat|Pinterest|TikTok|musical_ly|BytedanceWebview|GSA\/|; wv\)/i.test(userAgent);
}

/** iOS/iPadOS version from the UA (`OS 17_2`, or `Version/17.2` when iPadOS presents as a Mac). */
export function iosVersion(userAgent: string): [number, number] | null {
  const m = /OS (\d+)[_.](\d+)/.exec(userAgent) ?? /Version\/(\d+)\.(\d+)/.exec(userAgent);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/**
 * This iOS/iPadOS browser offers "Add to Home Screen" in its share sheet:
 * Safari always; Chrome, Firefox, Edge and other full browsers from iOS
 * 16.4. A webview inside another app has no share-sheet install.
 */
export function canAddToHomeScreenOnIOS(userAgent: string, maxTouchPoints: number): boolean {
  if (!isAppleMobile(userAgent, maxTouchPoints) || isInAppBrowser(userAgent)) return false;
  // Every full iOS browser carries the Safari token; an app's WKWebView does not.
  if (!/Safari\//.test(userAgent)) return false;
  const thirdParty = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|YaBrowser|DuckDuckGo|Brave/i.test(userAgent);
  if (!thirdParty) return true;
  const v = iosVersion(userAgent);
  return v !== null && (v[0] > 16 || (v[0] === 16 && v[1] >= 4));
}

/** Read what this browser remembers. Anything unreadable counts as nothing. */
export function parseInstallMemory(raw: string | null | undefined): InstallMemory | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === "object" && "state" in v) {
      if (v.state === "installed") return { state: "installed" };
      if (v.state === "snoozed" && "until" in v && typeof v.until === "number" && Number.isFinite(v.until)) return { state: "snoozed", until: v.until };
    }
  } catch {
    // fall through
  }
  return null;
}

export type InstallBannerInput = {
  routeAllowed: boolean;
  /** Running inside a frame. The app forbids framing, but the banner never shows there anyway. */
  embedded: boolean;
  phoneOrTablet: boolean;
  /** Running as the installed app: a standalone/fullscreen/minimal-ui/window-controls-overlay display mode, or iOS `navigator.standalone`. */
  runningInstalled: boolean;
  inAppBrowser: boolean;
  /** `getInstalledRelatedApps()` returned an entry. */
  relatedAppInstalled: boolean;
  /** `getInstalledRelatedApps()` exists and has not answered yet: wait rather than flash the banner. */
  relatedAppCheckPending: boolean;
  /** A `beforeinstallprompt` event is held and unused. */
  hasInstallPrompt: boolean;
  /** The iOS share sheet can add the app (canAddToHomeScreenOnIOS). */
  iosAddToHomeScreen: boolean;
  memory: InstallMemory | null;
  now: number;
};

export function installBannerVariant(i: InstallBannerInput): InstallBannerVariant {
  if (!i.routeAllowed || i.embedded || !i.phoneOrTablet || i.runningInstalled || i.inAppBrowser) return "hidden";
  if (i.memory?.state === "installed") return "hidden";
  if (i.memory?.state === "snoozed" && i.now < i.memory.until) return "hidden";
  if (i.relatedAppInstalled || i.relatedAppCheckPending) return "hidden";
  if (i.hasInstallPrompt) return "prompt";
  if (i.iosAddToHomeScreen) return "ios";
  return "hidden";
}
