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
