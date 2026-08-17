import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

const cardVariants = cva("rounded-[var(--r-lg)] p-5 sm:p-6", {
  variants: {
    variant: {
      // `default` and `raised` used to render identically (both the
      // --elev-raised ceiling), which meant every card on a page claimed
      // the same "popped out" prominence regardless of whether it was the
      // one thing on the page or the fourteenth item in a list. `raised` is
      // now the deliberate ceiling, reserved for a page's genuinely primary
      // surface (a lone form card, a hero illustration); `default` is the
      // routine tier for repeated or secondary content (list rows, saved
      // items, informational asides) — same rounding and fill, one shadow
      // step down.
      default: "surface-raised elev-flat",
      raised: "surface-raised elev-raised",
      // Emphasis comes from a warmer fill, not a second kind of shadow — so
      // this stays at the same --elev-flat tier as `default` rather than
      // also claiming --elev-raised, which would stack two emphasis signals
      // on one element.
      accent:
        "bg-[image:linear-gradient(145deg,color-mix(in_srgb,var(--accent)_15%,var(--neu-raised)),var(--neu-raised))] elev-flat",
      // Sunken, not just unshadowed: this is also the variant to reach for
      // when a card sits inside another raised card. Stacking --elev-raised
      // on --elev-raised reads as two competing "pop out" claims on the same
      // surface family — --elev-inset instead reads as content *within* the
      // outer card, which is what nesting actually means here.
      quiet: "surface-sunken elev-inset",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export interface CardProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

export function Card({ className, variant, ...props }: CardProps) {
  return (
    <div className={cn(cardVariants({ variant }), className)} {...props} />
  );
}

export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-5 space-y-2", className)} {...props} />;
}

export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn(
        "text-xl font-semibold tracking-[-0.025em] text-[var(--text-primary)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn(
        "text-sm leading-6 text-[var(--text-secondary)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn(className)} {...props} />;
}

export { cardVariants };
