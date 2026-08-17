import type { Metadata, Viewport } from "next";
import Script from "next/script";
import type { ReactNode } from "react";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { AppProviders } from "@/components/providers/app-providers";
import { THEME_STORAGE_KEY } from "@/lib/theme";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("http://127.0.0.1:3000"),
  title: {
    default: "CrateCompass — discovery with a paper trail",
    template: "%s · CrateCompass",
  },
  description:
    "Trace artist relationships, translate a mood into a listening direction, and keep the discoveries that matter.",
  applicationName: "CrateCompass",
  category: "music",
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#0b0b0f",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body>
        <Script id="theme-init" strategy="beforeInteractive">
          {`try {
            if (localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)}) === "light") {
              document.documentElement.setAttribute("data-theme", "light");
            }
          } catch (e) {}`}
        </Script>
        <AppProviders>
          <a href="#main-content" className="skip-link">
            Skip to content
          </a>
          <div className="flex min-h-screen flex-col">
            <SiteHeader />
            <main
              id="main-content"
              tabIndex={-1}
              className="flex-1 outline-none"
            >
              {children}
            </main>
            <SiteFooter />
          </div>
        </AppProviders>
      </body>
    </html>
  );
}
