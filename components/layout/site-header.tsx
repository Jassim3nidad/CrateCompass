import { Compass } from "lucide-react";
import Link from "next/link";

import { MobileNav } from "@/components/layout/mobile-nav";
import { NavLink } from "@/components/layout/nav-link";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { signOut } from "@/features/auth/actions";
import { primaryNavigation } from "@/lib/navigation";
import { createClient } from "@/lib/supabase/server";

export async function SiteHeader() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(data?.claims?.sub);
  return (
    <header className="sticky top-0 z-40 bg-[color-mix(in_srgb,var(--neu-base)_88%,transparent)] backdrop-blur-xl">
      <div className="mx-auto flex h-17 max-w-[90rem] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="focus-ring group inline-flex min-h-11 items-center gap-3 rounded-full pr-3"
          aria-label="CrateCompass home"
        >
          <span className="surface-raised elev-flat grid size-9 place-items-center rounded-full text-[var(--amber-soft)] transition-shadow motion-reduce:transition-none">
            <Compass aria-hidden="true" className="size-4" />
          </span>
          <span className="text-sm font-bold tracking-[-0.02em] text-[var(--text-primary)]">
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
              className="focus-ring hover:surface-raised hover:elev-flat aria-[current=page]:surface-raised aria-[current=page]:elev-flat min-h-10 rounded-full px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition-[color,box-shadow] duration-[var(--duration-fast)] hover:text-[var(--text-primary)] aria-[current=page]:text-[var(--text-primary)] motion-reduce:transition-none"
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

        <div className="flex items-center gap-2">
          <ThemeToggle />
          {/* MobileNav's panel is elev-raised (it's a floating drawer, that's
              correct); a raised secondary/accent button slotted into it
              stacks a second raised claim on the same surface. ghost is
              flat at rest, matching the panel's own nav-link children. */}
          <MobileNav>
            {isAuthenticated ? (
              <form action={signOut}>
                <Button type="submit" variant="ghost" className="mt-2 w-full">
                  Sign out
                </Button>
              </form>
            ) : (
              <Button asChild variant="ghost" className="mt-2 w-full">
                <Link href="/auth/sign-in">Sign in</Link>
              </Button>
            )}
          </MobileNav>
        </div>
      </div>
    </header>
  );
}
