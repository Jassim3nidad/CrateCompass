import * as React from "react";

import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "min-h-32 w-full resize-y rounded-2xl border border-[var(--border-strong)] bg-[var(--surface-subtle)] px-4 py-3 text-base leading-7 text-[var(--foreground)] transition-colors outline-none placeholder:text-[var(--muted-dim)] hover:border-[var(--muted-dim)] focus-visible:border-[var(--focus)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--focus)_32%,transparent)] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
