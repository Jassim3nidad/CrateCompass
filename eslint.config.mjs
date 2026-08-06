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
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/providers/spotify/**", "@/lib/providers/spotify/*"],
              message:
                "Discovery and mood modules must not import Spotify provider modules. Spotify resolution belongs in features/spotify and features/playlists, neither of which imports an AI module.",
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
