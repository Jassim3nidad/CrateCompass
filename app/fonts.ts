import { Fraunces, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";

// Named --ff-* rather than --font-sans / --font-display: Tailwind's
// `@theme inline` block in globals.css already owns those two names (they
// back the auto-generated `.font-sans` / `.font-display` utilities). Reusing
// them here would mean two different mechanisms writing the same custom
// property, racing on cascade order instead of composing.
export const displayFont = Fraunces({
  subsets: ["latin"],
  weight: "variable",
  axes: ["SOFT", "WONK", "opsz"],
  display: "swap",
  variable: "--ff-display",
});

export const sansFont = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: "variable",
  display: "swap",
  variable: "--ff-sans",
});

export const monoFont = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--ff-mono",
});
