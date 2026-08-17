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
      // `focus-ring` replaces the old ring-2 pair: the brief requires focus
      // to never rely on shadow, and this input's resting state is now a
      // shadow (--elev-inset) that a ring-offset band would collide with in
      // exactly the way docs/product/phase-10-design-system.md already
      // documented for buttons — same fix, applied here for the first time.
      "focus-ring surface-sunken elev-inset disabled:surface-base min-h-12 w-full rounded-[var(--r-pill)] px-4 text-base text-[var(--text-primary)] transition-shadow placeholder:text-[var(--text-muted)] disabled:cursor-not-allowed disabled:text-[var(--text-muted)] disabled:shadow-none motion-reduce:transition-none",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";
