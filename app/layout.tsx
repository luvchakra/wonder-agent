import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeFlashGuard, brandTitle, wonderIdBrand } from "@/modules/ui";

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
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable}`}>
      <head>
        <ThemeFlashGuard />
      </head>
      <body>{children}</body>
    </html>
  );
}
