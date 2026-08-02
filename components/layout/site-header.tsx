import { Compass, Menu, X } from "lucide-react";
import Link from "next/link";

import { NavLink } from "@/components/layout/nav-link";
import { Button } from "@/components/ui/button";
import { primaryNavigation, secondaryNavigation } from "@/lib/navigation";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--background)_88%,transparent)] backdrop-blur-xl">
      <div className="mx-auto flex h-17 max-w-[90rem] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="group inline-flex min-h-11 items-center gap-3 rounded-full pr-3 focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none"
          aria-label="CrateCompass home"
        >
          <span className="grid size-9 place-items-center rounded-full border border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--amber-soft)] transition-colors group-hover:border-[var(--amber)] motion-reduce:transition-none">
            <Compass aria-hidden="true" className="size-4" />
          </span>
          <span className="text-sm font-bold tracking-[-0.02em] text-[var(--foreground)]">
            CrateCompass
          </span>
        </Link>

        <nav
          aria-label="Primary navigation"
          className="hidden items-center gap-1 lg:flex"
        >
          {primaryNavigation.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              className="min-h-10 rounded-full px-4 py-2 text-sm font-medium text-[var(--muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--foreground)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none aria-[current=page]:bg-[var(--surface-raised)] aria-[current=page]:text-[var(--foreground)] motion-reduce:transition-none"
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <Button asChild variant="ghost" size="sm">
            <Link href="/settings">Settings</Link>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <Link href="/auth/sign-in">Sign in</Link>
          </Button>
        </div>

        <details className="group relative lg:hidden">
          <summary className="grid size-11 cursor-pointer list-none place-items-center rounded-full border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--foreground)] hover:bg-[var(--surface-raised)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none [&::-webkit-details-marker]:hidden">
            <Menu aria-hidden="true" className="size-5 group-open:hidden" />
            <X aria-hidden="true" className="hidden size-5 group-open:block" />
            <span className="sr-only">Toggle navigation menu</span>
          </summary>
          <div className="absolute right-0 mt-3 w-[min(21rem,calc(100vw-2rem))] rounded-3xl border border-[var(--border-strong)] bg-[var(--surface-raised)] p-3 shadow-2xl">
            <nav aria-label="Mobile navigation" className="grid gap-1">
              {[...primaryNavigation, ...secondaryNavigation].map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.href}
                    href={item.href}
                    className="flex min-h-14 items-center gap-3 rounded-2xl px-3 text-sm text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none aria-[current=page]:bg-[var(--surface)] aria-[current=page]:text-[var(--foreground)]"
                  >
                    <Icon aria-hidden="true" className="size-4 shrink-0" />
                    <span>
                      <span className="block font-semibold">{item.label}</span>
                      <span className="block text-xs text-[var(--muted-dim)]">
                        {item.description}
                      </span>
                    </span>
                  </NavLink>
                );
              })}
              <Button asChild variant="accent" className="mt-2 w-full">
                <Link href="/auth/sign-in">Sign in</Link>
              </Button>
            </nav>
          </div>
        </details>
      </div>
    </header>
  );
}
