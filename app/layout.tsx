import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeFlashGuard } from "@/modules/ui";

/**
 * globals.css has always mapped --font-sans/--font-mono onto
 * --font-geist-sans/--font-geist-mono, but nothing ever defined those
 * variables, so every screen silently fell back to -apple-system. These
 * two declarations supply them. No token names or values change.
 */
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"], display: "swap" });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "WonderID",
  description: "Identity governance and security for human, machine and AI-agent identities",
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
