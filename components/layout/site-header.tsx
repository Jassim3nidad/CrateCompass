import { Compass } from "lucide-react";
import Link from "next/link";

import { MobileNav } from "@/components/layout/mobile-nav";
import { NavLink } from "@/components/layout/nav-link";
import { Button } from "@/components/ui/button";
import { signOut } from "@/features/auth/actions";
import { primaryNavigation } from "@/lib/navigation";
import { createClient } from "@/lib/supabase/server";

export async function SiteHeader() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(data?.claims?.sub);
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--background)_88%,transparent)] backdrop-blur-xl">
      <div className="mx-auto flex h-17 max-w-[90rem] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="focus-ring group inline-flex min-h-11 items-center gap-3 rounded-full pr-3"
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
              className="focus-ring min-h-10 rounded-full px-4 py-2 text-sm font-medium text-[var(--muted)] transition-colors duration-[var(--duration-fast)] hover:bg-[var(--surface)] hover:text-[var(--foreground)] aria-[current=page]:bg-[var(--surface-raised)] aria-[current=page]:text-[var(--foreground)] motion-reduce:transition-none"
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          {isAuthenticated ? (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/settings">Settings</Link>
              </Button>
              <form action={signOut}>
                <Button type="submit" variant="secondary" size="sm">
                  Sign out
                </Button>
              </form>
            </>
          ) : (
            <Button asChild variant="secondary" size="sm">
              <Link href="/auth/sign-in">Sign in</Link>
            </Button>
          )}
        </div>

        <MobileNav>
          {isAuthenticated ? (
            <form action={signOut}>
              <Button type="submit" variant="secondary" className="mt-2 w-full">
                Sign out
              </Button>
            </form>
          ) : (
            <Button asChild variant="accent" className="mt-2 w-full">
              <Link href="/auth/sign-in">Sign in</Link>
            </Button>
          )}
        </MobileNav>
      </div>
    </header>
  );
}
