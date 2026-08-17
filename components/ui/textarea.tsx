import * as React from "react";

import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      // Same focus-ring fix as Input: shadow is the resting state here, so
      // a ring-offset band would collide with it the way phase-10 already
      // documented for buttons.
      "focus-ring surface-sunken elev-inset disabled:surface-base min-h-32 w-full resize-y rounded-[var(--r-md)] px-4 py-3 text-base leading-7 text-[var(--foreground)] transition-shadow placeholder:text-[var(--muted-dim)] disabled:cursor-not-allowed disabled:text-[var(--text-muted)] disabled:shadow-none motion-reduce:transition-none",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
