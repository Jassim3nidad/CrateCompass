import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--border)]">
      <div className="mx-auto flex max-w-[90rem] flex-col gap-4 px-4 py-8 text-sm text-[var(--muted-dim)] sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
        <p>CrateCompass — discovery with a paper trail.</p>
        <nav
          aria-label="Footer navigation"
          className="flex flex-wrap gap-x-5 gap-y-2"
        >
          <Link className="hover:text-[var(--foreground)]" href="/settings">
            Privacy
          </Link>
          <Link className="hover:text-[var(--foreground)]" href="/history">
            History
          </Link>
          <Link className="hover:text-[var(--foreground)]" href="/auth/sign-up">
            Create account
          </Link>
        </nav>
      </div>
    </footer>
  );
}
