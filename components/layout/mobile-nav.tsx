"use client";

import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { NavLink } from "@/components/layout/nav-link";
import { primaryNavigation, secondaryNavigation } from "@/lib/navigation";

const ITEMS = [...primaryNavigation, ...secondaryNavigation];

/**
 * The small-screen navigation menu.
 *
 * This was a `<details>` element until Phase 10. That gave a working disclosure
 * for free, but nothing else a menu needs: Escape did not close it, a tap
 * outside did not close it, and following a link left it open behind the next
 * page. All three are behaviours a listener expects rather than niceties.
 *
 * It is deliberately *not* a modal dialog and does not trap focus. There is no
 * backdrop and the page behind stays operable, so trapping would take keyboard
 * focus hostage for a control that is merely open. The contract implemented
 * here is the disclosure one — `aria-expanded`, `aria-controls`, Escape closes
 * and returns focus to the trigger — which is what the markup actually claims.
 */
export function MobileNav({
  children,
}: {
  /**
   * Sign-in or sign-out, rendered by the server component that knows which.
   * Already-rendered JSX crosses the boundary fine; the navigation list does
   * not, because each entry carries a Lucide component and a function cannot
   * be serialised into a client component's props. Hence the direct import
   * above rather than an `items` prop.
   */
  readonly children: ReactNode;
}) {
  const panelId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();

  /**
   * Openness is derived, not stored: the menu is open while the route is still
   * the one it was opened on. Arriving somewhere new therefore closes it during
   * render — including via the browser's own back and forward — with no effect
   * synchronising a boolean against the router afterwards.
   */
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const open = openedAt !== null && openedAt === pathname;

  function close() {
    setOpenedAt(null);
  }

  useEffect(() => {
    if (!open) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      close();
      // Focus would otherwise fall back to <body>, stranding a keyboard user at
      // the top of the document with no idea where they were.
      triggerRef.current?.focus();
    }

    function onPointerDown(event: PointerEvent) {
      if (!(event.target instanceof Node)) {
        return;
      }

      if (!containerRef.current?.contains(event.target)) {
        close();
      }
    }

    function onFocusIn(event: FocusEvent) {
      if (!(event.target instanceof Node)) {
        return;
      }

      // Tabbing past the last link is a deliberate exit, not a dismissal to
      // undo — so the menu closes and focus is left where the user put it.
      if (!containerRef.current?.contains(event.target)) {
        close();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative lg:hidden">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpenedAt(open ? null : pathname)}
        className="focus-ring grid size-11 place-items-center rounded-full border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--foreground)] transition-colors duration-[var(--duration-fast)] hover:bg-[var(--surface-raised)] motion-reduce:transition-none"
      >
        {open ? (
          <X aria-hidden="true" className="size-5" />
        ) : (
          <Menu aria-hidden="true" className="size-5" />
        )}
        <span className="sr-only">
          {open ? "Close navigation menu" : "Open navigation menu"}
        </span>
      </button>

      <div
        id={panelId}
        hidden={!open}
        className="motion-expand absolute right-0 mt-3 w-[min(21rem,calc(100vw-2rem))] rounded-3xl border border-[var(--border-strong)] bg-[var(--surface-raised)] p-3 shadow-[var(--elevation-3)]"
      >
        <nav
          aria-label="Mobile navigation"
          className="grid gap-1"
          // Covers the case the derived state cannot: a link to the route
          // already showing leaves the pathname unchanged, so nothing would
          // close the menu the listener just used.
          onClick={close}
        >
          {ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.href}
                href={item.href}
                className="focus-ring flex min-h-14 items-center gap-3 rounded-2xl px-3 text-sm text-[var(--muted)] transition-colors duration-[var(--duration-fast)] hover:bg-[var(--surface)] hover:text-[var(--foreground)] aria-[current=page]:bg-[var(--surface)] aria-[current=page]:text-[var(--foreground)] motion-reduce:transition-none"
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
          {children}
        </nav>
      </div>
    </div>
  );
}
