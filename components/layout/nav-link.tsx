"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

interface NavLinkProps extends ComponentProps<typeof Link> {
  readonly exact?: boolean;
}

export function NavLink({
  className,
  exact = false,
  href,
  ...props
}: NavLinkProps) {
  const pathname = usePathname();
  const destination = typeof href === "string" ? href : href.pathname;
  const isActive = destination
    ? exact
      ? pathname === destination
      : pathname === destination || pathname.startsWith(`${destination}/`)
    : false;

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={cn(className)}
      {...props}
    />
  );
}
