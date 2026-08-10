import type { LucideIcon } from "lucide-react";
import { Compass, History, Library, Settings, Sparkles } from "lucide-react";

export interface NavigationItem {
  readonly href: string;
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
}

export const primaryNavigation: readonly NavigationItem[] = [
  {
    href: "/discover",
    label: "Discover",
    description: "Trace artist relationships",
    icon: Compass,
  },
  {
    href: "/mood",
    label: "Mood",
    description: "Describe the listening moment",
    icon: Sparkles,
  },
  {
    href: "/library",
    label: "Library",
    description: "Keep meaningful finds",
    icon: Library,
  },
  {
    href: "/history",
    label: "History",
    description: "Revisit past trails",
    icon: History,
  },
];

// `/artists/[artistId]` is reachable from every discovery result and from the
// library, and there is no artist to name without one — so it is deliberately
// absent here. Phase 1 listed it pointing at a placeholder identifier, which
// offered a listener a menu entry leading to a page about nothing.
export const secondaryNavigation: readonly NavigationItem[] = [
  {
    href: "/settings",
    label: "Settings",
    description: "Privacy and connections",
    icon: Settings,
  },
];
