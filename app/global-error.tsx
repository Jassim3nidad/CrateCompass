"use client";

import { Button } from "@/components/ui/button";

export default function GlobalError({ reset }: { readonly reset: () => void }) {
  // Hardcoded hex, not var(--token): this renders in place of the root
  // layout, which is what just failed, so it can't safely assume
  // globals.css's custom properties are available. Values are copied from
  // the dark theme (--background, --foreground, --amber-soft, --muted) and
  // need updating by hand if those ever change, which is what happened
  // silently here until this comment existed.
  return (
    <html lang="en">
      <body className="grid min-h-screen place-items-center bg-[#0b0b0f] p-6 text-[#f4f0e8]">
        <main className="max-w-lg text-center">
          <p className="text-sm font-bold tracking-[0.2em] text-[#e8935a] uppercase">
            CrateCompass
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em]">
            The application shell could not load.
          </h1>
          <p className="mt-4 leading-7 text-[#aaa6b0]">
            Try again. No provider operation has been assumed successful.
          </p>
          <Button className="mt-7" onClick={reset}>
            Try again
          </Button>
        </main>
      </body>
    </html>
  );
}
