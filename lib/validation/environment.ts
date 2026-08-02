import { z } from "zod";

const optionalSecret = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

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
    SPOTIFY_CLIENT_SECRET: optionalSecret,
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
  .passthrough();

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
