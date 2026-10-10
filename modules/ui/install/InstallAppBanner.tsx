"use client";

import { useEffect, useId, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Share, X } from "lucide-react";
import { Button } from "../Button";
import { wonderIdBrand } from "../brand";
import {
  canAddToHomeScreenOnIOS,
  installBannerVariant,
  isInAppBrowser,
  isInstallBannerRoute,
  isPhoneOrTablet,
  type InstallBannerVariant,
} from "./eligibility";
import {
  clearInstallPrompt,
  heldInstallPrompt,
  installPromptVersion,
  isRunningInstalled,
  readInstallMemory,
  rememberInstalled,
  snoozeInstallBanner,
  subscribeInstallPrompt,
} from "./prompt";

type RelatedAppsNavigator = Navigator & {
  userAgentData?: { mobile?: boolean };
  getInstalledRelatedApps?: () => Promise<unknown[]>;
};

type RelatedCheck = "pending" | "installed" | "none";

/** The browser facts eligibility.ts decides on, read on the client only. */
function readFacts(pathname: string | null) {
  const nav = window.navigator as RelatedAppsNavigator;
  const userAgent = nav.userAgent;
  const maxTouchPoints = nav.maxTouchPoints ?? 0;
  const coarsePointer = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  let embedded = false;
  try {
    embedded = window.self !== window.top;
  } catch {
    embedded = true;
  }
  const routeAllowed = isInstallBannerRoute(pathname);
  const phoneOrTablet = isPhoneOrTablet({ userAgent, uaDataMobile: nav.userAgentData?.mobile, maxTouchPoints, coarsePointer });
  const runningInstalled = isRunningInstalled();
  return {
    routeAllowed,
    embedded,
    phoneOrTablet,
    runningInstalled,
    inAppBrowser: isInAppBrowser(userAgent),
    iosAddToHomeScreen: canAddToHomeScreenOnIOS(userAgent, maxTouchPoints),
    /** Worth asking getInstalledRelatedApps(): it exists and nothing else has ruled the banner out. */
    shouldCheckRelated: typeof nav.getInstalledRelatedApps === "function" && routeAllowed && !embedded && phoneOrTablet && !runningInstalled,
  };
}

function decide(pathname: string | null, related: RelatedCheck | null): { variant: InstallBannerVariant; shouldCheckRelated: boolean } {
  const f = readFacts(pathname);
  const variant = installBannerVariant({
    ...f,
    relatedAppInstalled: related === "installed",
    relatedAppCheckPending: f.shouldCheckRelated && (related === null || related === "pending"),
    hasInstallPrompt: heldInstallPrompt() !== null,
    memory: readInstallMemory(),
    now: Date.now(),
  });
  return { variant, shouldCheckRelated: f.shouldCheckRelated };
}

const noStore = () => -1;

/**
 * EXPERIENCE-P0-26 — "install the app" on phones and tablets, at the very
 * top of the page above the header, in the document flow so it pushes the
 * page down rather than covering it. Rendered once, by the root layout;
 * eligibility.ts decides whether it shows. Nothing renders on the server
 * or during hydration, so it never causes a hydration mismatch.
 */
export function InstallAppBanner() {
  const pathname = usePathname();
  // -1 on the server and while hydrating; then bumps whenever the held
  // prompt or the installed state changes.
  const version = useSyncExternalStore(subscribeInstallPrompt, installPromptVersion, noStore);
  const [related, setRelated] = useState<RelatedCheck | null>(null);
  const [closed, setClosed] = useState(false);
  const [howTo, setHowTo] = useState(false);
  const [busy, setBusy] = useState(false);
  const stepsId = useId();

  const { variant, shouldCheckRelated } = version < 0 || closed ? { variant: "hidden" as const, shouldCheckRelated: false } : decide(pathname, related);

  // In a normal tab, ask whether this app is already installed here (the
  // manifest lists itself in related_applications). Until it answers, the
  // banner waits rather than flashing.
  useEffect(() => {
    if (!shouldCheckRelated || related !== null) return;
    let live = true;
    const nav = window.navigator as RelatedAppsNavigator;
    nav
      .getInstalledRelatedApps?.()
      .then((apps) => {
        if (!live) return;
        if (apps.length > 0) rememberInstalled();
        setRelated(apps.length > 0 ? "installed" : "none");
      })
      .catch(() => live && setRelated("none"));
    return () => {
      live = false;
    };
  }, [shouldCheckRelated, related]);

  if (variant === "hidden") return null;

  function dismiss() {
    snoozeInstallBanner(Date.now());
    setClosed(true);
  }

  function added() {
    // A Safari tab cannot see the installed app, so take the person's word for it.
    rememberInstalled();
    setClosed(true);
  }

  async function install() {
    const prompt = heldInstallPrompt();
    if (!prompt) return;
    setBusy(true);
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === "accepted") rememberInstalled();
      else snoozeInstallBanner(Date.now());
    } catch {
      // The event was already used or the browser refused: nothing to remember.
    } finally {
      // A prompt can be shown once; the browser fires a new event if it may ask again.
      clearInstallPrompt();
      setBusy(false);
      setClosed(true);
    }
  }

  const app = wonderIdBrand.app;

  return (
    <div
      role="region"
      aria-label={`Install the ${wonderIdBrand.name} app`}
      data-slot="install-banner"
      data-variant={variant}
      className="install-banner-enter grid border-b border-border bg-card pt-[env(safe-area-inset-top)] text-card-foreground print:hidden"
    >
      <div className="min-h-0 overflow-hidden">
        <div className="mx-auto flex max-w-3xl items-center gap-3 py-2 pl-4 pr-2 sm:pl-6 sm:pr-4">
          <Image
            src={app.icon192.src}
            width={40}
            height={40}
            alt=""
            unoptimized
            draggable={false}
            className="size-10 shrink-0 rounded-[10px] shadow-sm ring-1 ring-border"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-5">{wonderIdBrand.name}</p>
            <p className="text-xs leading-4 text-muted-foreground">Approvals and findings on your home screen, full screen.</p>
          </div>
          {variant === "prompt" ? (
            <Button onClick={install} disabled={busy} aria-busy={busy || undefined} className="h-10 shrink-0 rounded-full px-4">
              Install
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => setHowTo((v) => !v)}
              aria-expanded={howTo}
              aria-controls={stepsId}
              className="h-10 shrink-0 rounded-full px-4"
            >
              How to
            </Button>
          )}
          <button
            type="button"
            onClick={dismiss}
            aria-label="Close"
            title="Not now"
            className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        {variant === "ios" ? (
          <div id={stepsId} hidden={!howTo} className="mx-auto max-w-3xl px-4 pb-3 sm:px-6">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-muted px-3 py-2.5">
              <ol className="min-w-0 flex-1 space-y-1 text-sm">
                <li>
                  1. Tap{" "}
                  <span className="whitespace-nowrap font-medium">
                    Share <Share className="inline size-4 -translate-y-px align-middle text-primary" aria-hidden="true" />
                  </span>{" "}
                  <span className="whitespace-nowrap text-muted-foreground">(under ••• if hidden)</span>
                </li>
                <li>
                  2. Choose <span className="font-medium">Add to Home Screen</span>
                </li>
              </ol>
              <Button variant="outline" onClick={added} className="ml-auto h-10 shrink-0 rounded-full px-4">
                I&apos;ve added it
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
