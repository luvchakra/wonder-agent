import type { Metadata } from "next";
import "./globals.css";
import { ThemeFlashGuard } from "@/modules/ui";

export const metadata: Metadata = {
  title: "WonderAgent",
  description: "AI Identity Governance & Runtime Assurance",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeFlashGuard />
      </head>
      <body>{children}</body>
    </html>
  );
}
