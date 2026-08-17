import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

const cardVariants = cva("rounded-[var(--r-lg)] p-5 sm:p-6", {
  variants: {
    variant: {
      // `raised` had extra emphasis (a heavier shadow) over `default` in the
      // legacy system; --elev-raised is the ceiling here (the brief reserves
      // the one colour shadow for the accent button), so both variants now
      // render identically. Names kept for API compatibility.
      default: "surface-raised elev-raised",
      raised: "surface-raised elev-raised",
      // Emphasis comes from a warmer fill, not a second kind of shadow —
      // still --elev-raised underneath.
      accent:
        "bg-[image:linear-gradient(145deg,color-mix(in_srgb,var(--accent)_15%,var(--neu-raised)),var(--neu-raised))] elev-raised",
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
