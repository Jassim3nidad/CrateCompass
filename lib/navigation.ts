import type { LucideIcon } from "lucide-react";
import {
  Compass,
  Disc3,
  History,
  Library,
  Settings,
  Sparkles,
} from "lucide-react";

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

export const secondaryNavigation: readonly NavigationItem[] = [
  {
    href: "/artists/foundation-preview",
    label: "Artist view",
    description: "Preview the artist workspace",
    icon: Disc3,
  },
  {
    href: "/settings",
    label: "Settings",
    description: "Privacy and connections",
    icon: Settings,
  },
];
