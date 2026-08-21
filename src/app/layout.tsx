import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Survivor 2026",
    template: "%s · Survivor 2026",
  },
  description:
    "2026 NFL Survivor Pool — live standings, picks grid, and pool tracker.",
};

export const viewport: Viewport = {
  themeColor: "#0B0D0F",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-dvh`}
      >
        <SiteHeader />
        <main className="mx-auto w-full max-w-7xl px-4 pb-16 pt-6 sm:px-6">
          {children}
        </main>
      </body>
    </html>
  );
}
