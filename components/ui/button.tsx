import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "focus-ring inline-flex min-h-11 items-center justify-center gap-2 text-sm font-semibold tracking-[-0.01em] transition-[color,background-color,box-shadow,filter,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:shadow-none disabled:surface-base disabled:text-[var(--text-muted)] active:translate-y-px motion-reduce:transition-none motion-reduce:active:translate-y-0",
  {
    variants: {
      variant: {
        // Full pill rounding used to apply to every variant at every size,
        // which meant it stopped signalling anything — a filter chip and
        // the one call-to-action on the page wore the same shape. Pill is
        // now reserved for `accent`, the one variant meant to read as *the*
        // action; every other variant takes the smaller, more rectangular
        // --r-md a routine control uses.
        //
        // Same treatment as `secondary`: the reference palette's near-white
        // fill this used is exactly the "white-on-gray" the brief rules out.
        // Both variants keep their names (no consumer prop changes) and
        // simply render identically now.
        primary:
          "surface-raised rounded-[var(--r-md)] px-5 text-[var(--text-primary)] elev-flat hover:elev-raised active:elev-inset",
        // The brief's one coloured-shadow element, and the one pill. Solid
        // fill, not a gradient — see --accent-glow's comment in globals.css
        // for why a diagonal gradient was dropped once it stopped being a
        // contrast workaround.
        accent:
          "rounded-[var(--r-pill)] bg-[var(--accent-deep)] px-5 text-[var(--text-on-accent)] elev-accent hover:brightness-95",
        secondary:
          "surface-raised rounded-[var(--r-md)] px-5 text-[var(--text-primary)] elev-flat hover:elev-raised active:elev-inset",
        ghost:
          "rounded-[var(--r-md)] bg-transparent px-4 text-[var(--text-secondary)] hover:surface-raised hover:elev-flat hover:text-[var(--text-primary)]",
        // Same raised/flat shape language as secondary — the brief reserves
        // the only coloured shadow for `accent`, so danger is signalled by
        // label colour alone, not a second coloured shadow.
        destructive:
          "surface-raised rounded-[var(--r-md)] px-5 text-[var(--danger-soft)] elev-flat hover:elev-raised active:elev-inset",
      },
      size: {
        default: "h-11",
        // 36px is fine as a visual size on desktop, but fails the 44px touch
        // floor — `touch-target-sm` (globals.css) restores it to 44px under
        // `@media (pointer: coarse)` only, so mouse users keep the smaller
        // control.
        sm: "h-9 min-h-9 touch-target-sm px-3 text-xs",
        lg: "h-12 px-6 text-base",
        // Square regardless of variant, including accent: a pill on a
        // square icon-only box just renders as a circle, which reads as a
        // different, unrelated control convention (an avatar or a toggle),
        // not as "the primary action" — the signal --r-pill is meant to
        // carry here. Rounded-square keeps it legible as a button.
        icon: "size-11 rounded-[var(--r-md)] p-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  readonly asChild?: boolean;
  /**
   * React 19 passes `ref` through as an ordinary prop for function components,
   * so it needs declaring here — `ButtonHTMLAttributes` does not include it.
   * Focus management after an optimistic update depends on it.
   */
  readonly ref?: React.Ref<HTMLButtonElement>;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot : "button";

  return (
    <Component
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { buttonVariants };
