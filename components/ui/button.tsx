import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full border text-sm font-semibold tracking-[-0.01em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] disabled:pointer-events-none disabled:opacity-45 active:translate-y-px motion-reduce:transition-none motion-reduce:active:translate-y-0",
  {
    variants: {
      variant: {
        primary:
          "border-transparent bg-[var(--foreground)] px-5 text-[var(--background)] hover:bg-white",
        accent:
          "border-transparent bg-[var(--violet)] px-5 text-white hover:bg-[var(--violet-strong)]",
        secondary:
          "border-[var(--border-strong)] bg-[var(--surface)] px-5 text-[var(--foreground)] hover:border-[var(--muted)] hover:bg-[var(--surface-raised)]",
        ghost:
          "border-transparent bg-transparent px-4 text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]",
        destructive:
          "border-[color-mix(in_srgb,var(--danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] px-5 text-[var(--danger-soft)] hover:bg-[color-mix(in_srgb,var(--danger)_20%,transparent)]",
      },
      size: {
        default: "h-11",
        sm: "h-9 min-h-9 px-3 text-xs",
        lg: "h-12 px-6 text-base",
        icon: "size-11 p-0",
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
