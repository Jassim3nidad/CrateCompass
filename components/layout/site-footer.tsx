import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="surface-base">
      <div className="mx-auto flex max-w-[90rem] flex-col gap-4 px-4 py-8 text-sm text-[var(--text-muted)] sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
        <p>CrateCompass — discovery with a paper trail.</p>
        <nav
          aria-label="Footer navigation"
          className="flex flex-wrap gap-x-5 gap-y-2"
        >
          <Link
            className="focus-ring rounded hover:text-[var(--text-primary)]"
            href="/settings"
          >
            Privacy
          </Link>
          <Link
            className="focus-ring rounded hover:text-[var(--text-primary)]"
            href="/history"
          >
            History
          </Link>
          <Link
            className="focus-ring rounded hover:text-[var(--text-primary)]"
            href="/auth/sign-up"
          >
            Create account
          </Link>
        </nav>
      </div>
    </footer>
  );
}
