import * as React from "react";

import { cn } from "@/lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<"input">
>(({ className, type, ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(
      "min-h-12 w-full rounded-2xl border border-[var(--border-strong)] bg-[var(--surface-subtle)] px-4 text-base text-[var(--foreground)] transition-colors outline-none placeholder:text-[var(--muted-dim)] hover:border-[var(--muted-dim)] focus-visible:border-[var(--focus)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--focus)_32%,transparent)] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";
