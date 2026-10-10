// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { INSTALL_STORAGE_KEY } from "./eligibility";

/** EXPERIENCE-P0-26 — the banner component over the browser facts it reads. */

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

import { InstallAppBanner } from "./InstallAppBanner";

const UA = {
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  chromeAndroid: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
  windowsChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
};

function browser(ua: string, { coarse = true, touch = 5, standalone = false } = {}) {
  Object.defineProperty(window.navigator, "userAgent", { value: ua, configurable: true });
  Object.defineProperty(window.navigator, "maxTouchPoints", { value: touch, configurable: true });
  window.matchMedia = ((query: string) => ({
    matches: query === "(pointer: coarse)" ? coarse : query === "(display-mode: standalone)" ? standalone : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

function firePrompt(outcome: "accepted" | "dismissed") {
  const e = new Event("beforeinstallprompt", { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
  e.prompt = vi.fn(async () => {});
  e.userChoice = Promise.resolve({ outcome });
  act(() => {
    window.dispatchEvent(e);
  });
  return e;
}

beforeEach(() => {
  pathname = "/";
  window.localStorage.clear();
  window.__wonderidInstallPrompt = null;
  delete (window.navigator as { getInstalledRelatedApps?: unknown }).getInstalledRelatedApps;
});
afterEach(cleanup);

describe("InstallAppBanner", () => {
  it("shows nothing on desktop", () => {
    browser(UA.windowsChrome, { coarse: false, touch: 0 });
    const { container } = render(<InstallAppBanner />);
    firePrompt("accepted");
    expect(container).toBeEmptyDOMElement();
  });

  it("iOS Safari: the How to steps, and 'I've added it' hides it for good", () => {
    browser(UA.iphoneSafari);
    render(<InstallAppBanner />);
    const region = screen.getByRole("region", { name: "Install the WonderID app" });
    expect(region).toHaveAttribute("data-variant", "ios");
    const howTo = screen.getByRole("button", { name: "How to" });
    expect(howTo).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(howTo);
    expect(howTo).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Add to Home Screen")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "I've added it" }));
    expect(screen.queryByRole("region")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(INSTALL_STORAGE_KEY)!)).toEqual({ state: "installed" });
  });

  it("closing snoozes it for 14 days", () => {
    browser(UA.iphoneSafari);
    render(<InstallAppBanner />);
    const before = Date.now();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("region")).toBeNull();
    const stored = JSON.parse(window.localStorage.getItem(INSTALL_STORAGE_KEY)!);
    expect(stored.state).toBe("snoozed");
    expect(stored.until).toBeGreaterThanOrEqual(before + 14 * 24 * 3600 * 1000);
  });

  it("Chromium phone: appears only after beforeinstallprompt, and Install opens the browser prompt", async () => {
    browser(UA.chromeAndroid);
    render(<InstallAppBanner />);
    expect(screen.queryByRole("region")).toBeNull();
    const e = firePrompt("dismissed");
    expect(e.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    await waitFor(() => expect(screen.queryByRole("region")).toBeNull());
    expect(e.prompt).toHaveBeenCalledOnce();
    // Declined → snoozed, not installed.
    expect(JSON.parse(window.localStorage.getItem(INSTALL_STORAGE_KEY)!).state).toBe("snoozed");
  });

  it("hides when getInstalledRelatedApps reports the app, and when the app is installed", async () => {
    browser(UA.chromeAndroid);
    (window.navigator as { getInstalledRelatedApps?: () => Promise<unknown[]> }).getInstalledRelatedApps = async () => [{ platform: "webapp" }];
    render(<InstallAppBanner />);
    firePrompt("accepted");
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem(INSTALL_STORAGE_KEY) ?? "{}").state).toBe("installed"));
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("appinstalled hides it and remembers", () => {
    browser(UA.chromeAndroid);
    render(<InstallAppBanner />);
    firePrompt("accepted");
    expect(screen.getByRole("region")).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });
    expect(screen.queryByRole("region")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(INSTALL_STORAGE_KEY)!).state).toBe("installed");
  });

  it("never on the vendor console, nor when running installed", () => {
    browser(UA.iphoneSafari);
    pathname = "/platform-admin/tenants";
    const { container, unmount } = render(<InstallAppBanner />);
    expect(container).toBeEmptyDOMElement();
    unmount();
    pathname = "/";
    browser(UA.iphoneSafari, { standalone: true });
    expect(render(<InstallAppBanner />).container).toBeEmptyDOMElement();
  });

  it("keeps working when storage is blocked", () => {
    browser(UA.iphoneSafari);
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<InstallAppBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("region")).toBeNull();
    getItem.mockRestore();
    setItem.mockRestore();
  });
});
