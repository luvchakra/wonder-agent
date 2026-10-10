// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  INSTALL_SNOOZE_MS,
  canAddToHomeScreenOnIOS,
  installBannerVariant,
  isInAppBrowser,
  isInstallBannerRoute,
  isPhoneOrTablet,
  iosVersion,
  parseInstallMemory,
  type InstallBannerInput,
} from "./eligibility";

/** EXPERIENCE-P0-26 — when the install banner shows, per platform. */

const UA = {
  chromeAndroid: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
  chromeAndroidTablet: "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  samsungInternet: "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
  firefoxAndroid: "Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0",
  androidWebView: "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.0.0 Mobile Safari/537.36",
  instagramAndroid: "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.0.0 Mobile Safari/537.36 Instagram 349.0.0.0",
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  iphoneChrome17: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1",
  iphoneChrome16_3: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/110.0.5481.83 Mobile/15E148 Safari/604.1",
  iphoneInstagram: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 349.0.0.21.106",
  iphoneFacebook: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0.0.0]",
  iphoneLinkedIn: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 LinkedInApp/9.30",
  ipadOSAsMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  windowsChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
};

/** Everything that would show a banner, so each test flips one fact. */
const base: InstallBannerInput = {
  routeAllowed: true,
  embedded: false,
  phoneOrTablet: true,
  runningInstalled: false,
  inAppBrowser: false,
  relatedAppInstalled: false,
  relatedAppCheckPending: false,
  hasInstallPrompt: false,
  iosAddToHomeScreen: false,
  memory: null,
  now: 1_800_000_000_000,
};

/** The facts a real browser with this UA would report. */
function facts(ua: string, opts: { touch?: number; coarse?: boolean; uaDataMobile?: boolean; prompt?: boolean } = {}): InstallBannerInput {
  const touch = opts.touch ?? 5;
  return {
    ...base,
    phoneOrTablet: isPhoneOrTablet({ userAgent: ua, uaDataMobile: opts.uaDataMobile, maxTouchPoints: touch, coarsePointer: opts.coarse ?? true }),
    inAppBrowser: isInAppBrowser(ua),
    iosAddToHomeScreen: canAddToHomeScreenOnIOS(ua, touch),
    hasInstallPrompt: opts.prompt ?? false,
  };
}

describe("installBannerVariant", () => {
  it("desktop → hidden, even with an install prompt and a touchscreen", () => {
    expect(installBannerVariant(facts(UA.windowsChrome, { touch: 10, coarse: false, uaDataMobile: false, prompt: true }))).toBe("hidden");
    // A touch laptop whose primary pointer is the finger is still not a phone or tablet.
    expect(installBannerVariant(facts(UA.windowsChrome, { touch: 10, coarse: true, uaDataMobile: false, prompt: true }))).toBe("hidden");
    expect(installBannerVariant(facts(UA.macSafari, { touch: 0, coarse: false }))).toBe("hidden");
  });

  it("running as the installed app → hidden", () => {
    expect(installBannerVariant({ ...facts(UA.chromeAndroid, { uaDataMobile: true, prompt: true }), runningInstalled: true })).toBe("hidden");
    expect(installBannerVariant({ ...facts(UA.iphoneSafari), runningInstalled: true })).toBe("hidden");
  });

  it("Chromium phone or tablet with a held beforeinstallprompt → one-tap Install", () => {
    expect(installBannerVariant(facts(UA.chromeAndroid, { uaDataMobile: true, prompt: true }))).toBe("prompt");
    expect(installBannerVariant(facts(UA.chromeAndroidTablet, { uaDataMobile: false, prompt: true }))).toBe("prompt");
    expect(installBannerVariant(facts(UA.samsungInternet, { prompt: true }))).toBe("prompt");
  });

  it("Chromium phone without the event (not installable, or already installed) → hidden", () => {
    expect(installBannerVariant(facts(UA.chromeAndroid, { uaDataMobile: true }))).toBe("hidden");
  });

  it("iOS Safari, iPadOS Safari (as a Mac) and iOS 16.4+ Chrome → the two-tap instructions", () => {
    expect(installBannerVariant(facts(UA.iphoneSafari))).toBe("ios");
    expect(installBannerVariant(facts(UA.ipadOSAsMac, { touch: 5 }))).toBe("ios");
    expect(installBannerVariant(facts(UA.iphoneChrome17))).toBe("ios");
  });

  it("iOS Chrome before 16.4 has no Add to Home Screen → hidden", () => {
    expect(installBannerVariant(facts(UA.iphoneChrome16_3))).toBe("hidden");
  });

  it("Firefox on Android and in-app webviews → hidden", () => {
    expect(installBannerVariant(facts(UA.firefoxAndroid))).toBe("hidden");
    expect(installBannerVariant(facts(UA.androidWebView))).toBe("hidden");
    expect(installBannerVariant(facts(UA.instagramAndroid, { prompt: true }))).toBe("hidden");
    expect(installBannerVariant(facts(UA.iphoneInstagram))).toBe("hidden");
    expect(installBannerVariant(facts(UA.iphoneFacebook))).toBe("hidden");
    expect(installBannerVariant(facts(UA.iphoneLinkedIn))).toBe("hidden");
  });

  it("installed according to getInstalledRelatedApps → hidden; while it is still answering → hidden", () => {
    const chrome = facts(UA.chromeAndroid, { uaDataMobile: true, prompt: true });
    expect(installBannerVariant({ ...chrome, relatedAppInstalled: true })).toBe("hidden");
    expect(installBannerVariant({ ...chrome, relatedAppCheckPending: true })).toBe("hidden");
  });

  it("snoozed → hidden until the snooze ends; installed → hidden for good", () => {
    const chrome = facts(UA.chromeAndroid, { uaDataMobile: true, prompt: true });
    const until = base.now + INSTALL_SNOOZE_MS;
    expect(installBannerVariant({ ...chrome, memory: { state: "snoozed", until } })).toBe("hidden");
    expect(installBannerVariant({ ...chrome, memory: { state: "snoozed", until }, now: until })).toBe("prompt");
    expect(installBannerVariant({ ...facts(UA.iphoneSafari), memory: { state: "installed" }, now: base.now + 10 * INSTALL_SNOOZE_MS })).toBe("hidden");
  });

  it("excluded routes and embedded views → hidden", () => {
    const chrome = facts(UA.chromeAndroid, { uaDataMobile: true, prompt: true });
    expect(installBannerVariant({ ...chrome, routeAllowed: false })).toBe("hidden");
    expect(installBannerVariant({ ...chrome, embedded: true })).toBe("hidden");
  });
});

describe("isInstallBannerRoute", () => {
  it("public pages and the customer app", () => {
    for (const p of ["/", "/welcome", "/sign-in", "/help", "/agents", "/access/requests", "/risk/findings/abc"]) expect(isInstallBannerRoute(p), p).toBe(true);
  });
  it("never the vendor console, auth callbacks, the API, or print/export/embedded views", () => {
    for (const p of ["/platform-admin", "/platform-admin/tenants", "/auth/callback", "/api/v1/search", "/reports/print", "/audit/export/123", "/x/embed"]) {
      expect(isInstallBannerRoute(p), p).toBe(false);
    }
    expect(isInstallBannerRoute(null)).toBe(false);
  });
});

describe("helpers", () => {
  it("isPhoneOrTablet needs a coarse primary pointer", () => {
    expect(isPhoneOrTablet({ userAgent: UA.chromeAndroid, uaDataMobile: true, maxTouchPoints: 5, coarsePointer: false })).toBe(false);
    expect(isPhoneOrTablet({ userAgent: UA.iphoneSafari, maxTouchPoints: 5, coarsePointer: true })).toBe(true);
    expect(isPhoneOrTablet({ userAgent: UA.macSafari, maxTouchPoints: 0, coarsePointer: true })).toBe(false);
  });

  it("iosVersion reads the iPhone and the iPadOS-as-Mac forms", () => {
    expect(iosVersion(UA.iphoneChrome16_3)).toEqual([16, 3]);
    expect(iosVersion(UA.ipadOSAsMac)).toEqual([18, 0]);
  });

  it("parseInstallMemory accepts only the two shapes it writes", () => {
    expect(parseInstallMemory('{"state":"installed"}')).toEqual({ state: "installed" });
    expect(parseInstallMemory('{"state":"snoozed","until":5}')).toEqual({ state: "snoozed", until: 5 });
    for (const raw of [null, "", "nope", "{}", '{"state":"snoozed"}', '{"state":"snoozed","until":"5"}', '{"state":"other"}']) {
      expect(parseInstallMemory(raw), String(raw)).toBeNull();
    }
  });
});
