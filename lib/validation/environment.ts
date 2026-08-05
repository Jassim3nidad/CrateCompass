import { z } from "zod";

const optionalSecret = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

const ENCRYPTION_KEY_BYTE_LENGTH = 32;

/**
 * Base64 decoding is lenient, so the round-trip comparison is what rejects
 * malformed keys rather than silently accepting a truncated one.
 */
function isEncryptionKeyWellFormed(value: string): boolean {
  const decoded = Buffer.from(value, "base64");
  return (
    decoded.byteLength === ENCRYPTION_KEY_BYTE_LENGTH &&
    decoded.toString("base64") === value
  );
}

export const serverEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]),
    NEXT_PUBLIC_APP_URL: z.url().refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "https:" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "[::1]"
      );
    }, "must use HTTPS or an explicit loopback IP"),
    APP_ENV: z.enum(["development", "preview", "production", "test"]),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]),
    NEXT_PUBLIC_SUPABASE_URL: optionalSecret,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: optionalSecret,
    SUPABASE_SERVICE_ROLE_KEY: optionalSecret,
    SPOTIFY_CLIENT_ID: optionalSecret,
    // The Spotify client secret is deliberately not modelled here. ADR 0002
    // selects the PKCE flow, under which no application code reads it, and a
    // compliance test asserts that no module names that variable at all.
    SPOTIFY_REDIRECT_URI: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.url().optional(),
    ),
    SPOTIFY_TOKEN_ENCRYPTION_KEY: optionalSecret,
    SPOTIFY_TOKEN_ENCRYPTION_KEY_VERSION: z.coerce.number().int().positive(),
    MUSICBRAINZ_APP_NAME: z.string().min(1),
    MUSICBRAINZ_APP_VERSION: z.string().min(1),
    // Required from Phase 4 onward: MusicBrainz mandates a User-Agent carrying
    // a way to contact the maintainer, and throttles requests without one.
    MUSICBRAINZ_CONTACT: z.string().min(1),
    DISCOVERY_PROVIDER: z.enum(["lastfm", "listenbrainz"]),
    // Documented but unused. ADR 0003 selected ListenBrainz; a compliance test
    // asserts no module reads the Last.fm key.
    LISTENBRAINZ_USER_TOKEN: optionalSecret,
    LISTENBRAINZ_SIMILARITY_ALGORITHM: optionalSecret,
    AI_PROVIDER: z.enum(["openai", "anthropic", "openrouter", "gemini"]),
    GEMINI_API_KEY: optionalSecret,
    GEMINI_MODEL: optionalSecret,
    OPENAI_API_KEY: optionalSecret,
    OPENAI_MODEL: optionalSecret,
    ANTHROPIC_API_KEY: optionalSecret,
    ANTHROPIC_MODEL: optionalSecret,
    OPENROUTER_API_KEY: optionalSecret,
    OPENROUTER_MODEL: optionalSecret,
    RATE_LIMIT_STORE_URL: optionalSecret,
    RATE_LIMIT_STORE_TOKEN: optionalSecret,
    /**
     * Serves canned MusicBrainz and ListenBrainz data so the end-to-end suite
     * can exercise the discovery journey without touching a live provider.
     * Constrained below to `APP_ENV=test`, so a deployment that sets it by
     * accident refuses to boot rather than silently serving fixture artists.
     */
    PROVIDER_FIXTURES: z.enum(["0", "1"]).optional(),
  })
  .passthrough()
  .superRefine((environment, context) => {
    // The client secret is deliberately absent from this check: ADR 0002
    // selects the PKCE flow, under which no application code reads it.
    if (!environment.SPOTIFY_CLIENT_ID) {
      return;
    }

    if (!environment.SPOTIFY_TOKEN_ENCRYPTION_KEY) {
      context.addIssue({
        code: "custom",
        path: ["SPOTIFY_TOKEN_ENCRYPTION_KEY"],
        message:
          "is required whenever SPOTIFY_CLIENT_ID is set, because connected-account credentials cannot be stored without it",
      });
      return;
    }

    if (!isEncryptionKeyWellFormed(environment.SPOTIFY_TOKEN_ENCRYPTION_KEY)) {
      context.addIssue({
        code: "custom",
        path: ["SPOTIFY_TOKEN_ENCRYPTION_KEY"],
        message: `must be base64 decoding to exactly ${ENCRYPTION_KEY_BYTE_LENGTH} bytes`,
      });
    }

    if (!environment.SPOTIFY_REDIRECT_URI) {
      context.addIssue({
        code: "custom",
        path: ["SPOTIFY_REDIRECT_URI"],
        message: "is required whenever SPOTIFY_CLIENT_ID is set",
      });
    }
  })
  .superRefine((environment, context) => {
    // Fail closed rather than open. If this flag could take effect outside a
    // test environment, a misconfigured deployment would serve invented
    // artists as though they were provider data — a correctness and honesty
    // failure that would be very hard to notice from the outside.
    if (
      environment.PROVIDER_FIXTURES === "1" &&
      environment.APP_ENV !== "test"
    ) {
      context.addIssue({
        code: "custom",
        path: ["PROVIDER_FIXTURES"],
        message: 'may only be enabled when APP_ENV is "test"',
      });
    }
  })
  .superRefine((environment, context) => {
    // Only the selected provider's credentials are required. Both adapters are
    // always built, but requiring both keys would make switching providers a
    // deployment change rather than a configuration one.
    const credentialsByProvider = {
      anthropic: [
        ["ANTHROPIC_API_KEY", environment.ANTHROPIC_API_KEY],
        ["ANTHROPIC_MODEL", environment.ANTHROPIC_MODEL],
      ],
      openai: [
        ["OPENAI_API_KEY", environment.OPENAI_API_KEY],
        ["OPENAI_MODEL", environment.OPENAI_MODEL],
      ],
      openrouter: [
        ["OPENROUTER_API_KEY", environment.OPENROUTER_API_KEY],
        ["OPENROUTER_MODEL", environment.OPENROUTER_MODEL],
      ],
      gemini: [
        ["GEMINI_API_KEY", environment.GEMINI_API_KEY],
        ["GEMINI_MODEL", environment.GEMINI_MODEL],
      ],
    } as const satisfies Record<
      typeof environment.AI_PROVIDER,
      readonly (readonly [string, string | undefined])[]
    >;

    const required = credentialsByProvider[environment.AI_PROVIDER];

    for (const [name, value] of required) {
      if (!value) {
        context.addIssue({
          code: "custom",
          path: [name],
          message: `is required when AI_PROVIDER is "${environment.AI_PROVIDER}"`,
        });
      }
    }
  });

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

export function validateServerEnvironment(
  source: Record<string, string | undefined>,
): ServerEnvironment {
  const parsed = serverEnvironmentSchema.safeParse(source);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map(
        (issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`,
      )
      .join("; ");

    throw new Error(`Invalid CrateCompass environment: ${details}`);
  }

  return parsed.data;
}
