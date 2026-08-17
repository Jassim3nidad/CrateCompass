"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Toaster } from "sonner";

export function AppProviders({ children }: { readonly children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster
        theme="dark"
        position="bottom-right"
        richColors
        closeButton
        // Sonner's own default shadow, not a neumorphic recipe: a toast is a
        // genuine floating overlay — transient, layered above the page,
        // dismissed by the user — not a surface embedded in it, so a
        // conventional drop-shadow is the correct read here (same reasoning
        // as --elevation-1/2/3, kept for exactly this kind of element).
        // Border removed to match the rest of the system.
        toastOptions={{
          classNames: {
            toast: "!bg-[var(--surface-raised)] !text-[var(--foreground)]",
            description: "!text-[var(--muted)]",
          },
        }}
      />
    </QueryClientProvider>
  );
}
