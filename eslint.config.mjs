import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  // Spotify-to-AI dependency boundary. Keeping the two module trees disjoint
  // is what makes the runtime guard in lib/ai/input-guard.ts a second line of
  // defence rather than the only one. See docs/architecture/provider-boundaries.md.
  {
    files: ["lib/ai/**/*.ts", "lib/ai/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/providers/spotify/**", "@/lib/providers/spotify/*"],
              message:
                "AI modules must not import Spotify provider modules. Spotify-derived data may never reach an AI provider.",
            },
          ],
        },
      ],
    },
  },
  // Discovery evidence and its orchestration are the modules that build AI
  // input. Keeping them structurally unable to reach a Spotify adapter is what
  // makes "no Spotify content enters the AI layer" a property of the module
  // graph rather than a claim about the code inside it.
  // Phase 7 keeps the same shape: the modules that build AI input cannot reach
  // Spotify, and the module that creates playlists cannot reach AI.
  {
    files: ["features/playlists/**/*.ts", "features/playlists/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/lib/ai/**", "@/lib/ai", "@/lib/ai/*"],
              message:
                "Playlist creation must not import AI modules. Titles and descriptions are generated in features/mood before Spotify is involved.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "lib/discovery/**/*.ts",
      "features/discovery/**/*.ts",
      "lib/mood/**/*.ts",
      "features/mood/**/*.ts",
      // Phase 8 joins the same rule: the discography explorer builds AI input
      // from MusicBrainz records, so it must be structurally unable to reach a
      // Spotify adapter. Open-in-Spotify on that page resolves separately.
      "lib/discography/**/*.ts",
      "features/discography/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/providers/spotify/**", "@/lib/providers/spotify/*"],
              message:
                "Discovery, mood and discography modules must not import Spotify provider modules. Spotify resolution belongs in features/spotify and features/playlists, neither of which imports an AI module.",
            },
          ],
        },
      ],
    },
  },
  // Phase 9 is the first tree forbidden both directions at once, so both
  // patterns live in one rule. Flat config replaces `no-restricted-imports`
  // rather than merging it, so splitting these across two blocks would silently
  // drop whichever matched first.
  //
  // No Spotify provider: the library stores a playlist id and URL as the
  // "operationally required" exception and nothing more, and must not be able
  // to start mirroring catalogue data.
  //
  // No AI: the library renders explanations that were verified and stored when
  // they were made. One that quietly re-asked a model would show a different
  // reason than the one a listener kept, and spend their daily allowance to do
  // it.
  {
    files: [
      "lib/library/**/*.ts",
      "features/library/**/*.ts",
      "features/history/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/providers/spotify/**", "@/lib/providers/spotify/*"],
              message:
                "Library and history modules must not import Spotify provider modules. A stored playlist id and URL are the only Spotify values they may hold.",
            },
            {
              group: ["**/lib/ai/**", "@/lib/ai", "@/lib/ai/*"],
              message:
                "Library and history modules must not import AI modules. Explanations are snapshotted at save time and rendered from storage, never regenerated.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["lib/providers/spotify/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/ai/**", "@/lib/ai/*"],
              message:
                "Spotify provider modules must not import AI modules. Route product logic through a normalized domain type instead.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
