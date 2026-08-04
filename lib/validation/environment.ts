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
    MUSICBRAINZ_CONTACT: optionalSecret,
    DISCOVERY_PROVIDER: z.enum(["lastfm", "listenbrainz"]),
    LASTFM_API_KEY: optionalSecret,
    LISTENBRAINZ_USER_TOKEN: optionalSecret,
    AI_PROVIDER: z.enum(["openai", "anthropic"]),
    OPENAI_API_KEY: optionalSecret,
    OPENAI_MODEL: optionalSecret,
    ANTHROPIC_API_KEY: optionalSecret,
    ANTHROPIC_MODEL: optionalSecret,
    RATE_LIMIT_STORE_URL: optionalSecret,
    RATE_LIMIT_STORE_TOKEN: optionalSecret,
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
