import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeFlashGuard, brandTitle, wonderIdBrand } from "@/modules/ui";
import { InstallAppBanner } from "@/modules/ui/install/InstallAppBanner";
import { InstallPromptCapture } from "@/modules/ui/install/InstallPromptCapture";

/**
 * globals.css has always mapped --font-sans/--font-mono onto
 * --font-geist-sans/--font-geist-mono, but nothing ever defined those
 * variables, so every screen silently fell back to -apple-system. These
 * two declarations supply them. No token names or values change.
 */
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"], display: "swap" });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], display: "swap" });

// BRAND-005/§16–§18: "WonderID · <page>" by default; the customer shell
// switches to the organization-first form. Icons are app/icon.png,
// app/apple-icon.png and app/favicon.ico, cut from the brand sheet by
// scripts/brand/extract-assets.py.
export const metadata: Metadata = {
  title: { default: brandTitle(), template: `${wonderIdBrand.name} · %s` },
  description: "Identity governance and security for human, machine and AI-agent identities",
  openGraph: {
    siteName: wonderIdBrand.name,
    images: [{ url: wonderIdBrand.assets.social.src, width: wonderIdBrand.assets.social.width, height: wonderIdBrand.assets.social.height, alt: wonderIdBrand.name }],
  },
  // EXPERIENCE-P0-26 — installed on iOS: full screen, named WonderID, the
  // light status bar. Next emits `mobile-web-app-capable`; older iOS reads
  // only the apple- form. The manifest link comes from app/manifest.ts.
  appleWebApp: { capable: true, title: wonderIdBrand.name, statusBarStyle: "default" },
  other: { "apple-mobile-web-app-capable": "yes" },
};

// The browser and installed-app chrome take the header's colour in each theme.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: wonderIdBrand.app.themeColor },
    { media: "(prefers-color-scheme: dark)", color: wonderIdBrand.app.themeColorDark },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable}`}>
      <head>
        <ThemeFlashGuard />
        <InstallPromptCapture />
      </head>
      <body>
        {/* EXPERIENCE-P0-26 — phones and tablets only, when the browser can install the app. */}
        <InstallAppBanner />
        {children}
      </body>
    </html>
  );
}
