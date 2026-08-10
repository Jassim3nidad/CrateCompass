import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

const cardVariants = cva("rounded-[var(--radius-lg)] border p-5 sm:p-6", {
  variants: {
    variant: {
      default: "border-[var(--border)] bg-[var(--surface)]",
      raised:
        "border-[var(--border-strong)] bg-[var(--surface-raised)] shadow-[var(--elevation-3)]",
      accent:
        "border-[color-mix(in_srgb,var(--violet)_40%,var(--border))] bg-[linear-gradient(145deg,color-mix(in_srgb,var(--violet)_15%,var(--surface)),var(--surface))]",
      quiet: "border-transparent bg-[var(--surface-subtle)]",
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
        "text-xl font-semibold tracking-[-0.025em] text-[var(--foreground)]",
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
      className={cn("text-sm leading-6 text-[var(--muted)]", className)}
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
