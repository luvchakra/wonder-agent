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
// app/apple-icon.png and app/favicon.ico (built by scripts/brand) plus the
// scalable mark.
export const metadata: Metadata = {
  title: { default: brandTitle(), template: `${wonderIdBrand.name} · %s` },
  description: "Identity governance and security for human, machine and AI-agent identities",
  icons: { icon: [{ url: wonderIdBrand.assets.favicon.src, type: "image/svg+xml" }] },
  openGraph: { siteName: wonderIdBrand.name, images: [{ url: wonderIdBrand.assets.social, width: 1200, height: 630, alt: wonderIdBrand.name }] },
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
