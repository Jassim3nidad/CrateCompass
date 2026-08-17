"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

import { THEME_STORAGE_KEY } from "@/lib/theme";

type Theme = "light" | "dark";

const THEME_CHANGE_EVENT = "cratecompass:theme-change";

function subscribe(callback: () => void) {
  window.addEventListener(THEME_CHANGE_EVENT, callback);
  return () => window.removeEventListener(THEME_CHANGE_EVENT, callback);
}

function getSnapshot(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function getServerSnapshot(): Theme {
  return "dark";
}

/**
 * Dark is the default identity (see docs/product/phase-10-design-system.md),
 * so the server snapshot is always "dark" and light only applies once
 * hydrated. Reads the live `data-theme` attribute via useSyncExternalStore
 * rather than useState+useEffect — the effect version tripped
 * react-hooks/set-state-in-effect (a synchronous setState in an effect body
 * cascades an extra render), and useSyncExternalStore is the API actually
 * designed for "observe an external mutable value and re-render when it
 * changes": the beforeInteractive script in the root layout is what mutates
 * the DOM before hydration, this just observes it.
 */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const isLight = theme === "light";

  function toggle() {
    const next: Theme = isLight ? "dark" : "light";
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
    if (next === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isLight ? "Switch to dark theme" : "Switch to light theme"}
      className={`focus-ring grid size-11 shrink-0 place-items-center rounded-[var(--r-md)] transition-[color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-out)] motion-reduce:transition-none ${
        isLight
          ? "surface-sunken elev-inset text-[var(--accent-foreground)]"
          : "surface-raised elev-flat text-[var(--text-secondary)]"
      }`}
    >
      {isLight ? (
        <Sun aria-hidden="true" className="size-5" />
      ) : (
        <Moon aria-hidden="true" className="size-5" />
      )}
    </button>
  );
}
