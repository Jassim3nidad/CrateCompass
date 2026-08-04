import "@testing-library/jest-dom/vitest";

// Synthetic provider configuration, assigned unconditionally rather than with
// `??=` so a developer's real credentials in the shell can never leak into a
// test run. The compliance plan requires that automated tests never touch a
// real Spotify account.
process.env.APP_ENV = "test";
process.env.LOG_LEVEL = "error";
process.env.NEXT_PUBLIC_APP_URL = "http://127.0.0.1:3000";
process.env.MUSICBRAINZ_APP_NAME = "CrateCompass";
process.env.MUSICBRAINZ_APP_VERSION = "0.1.0";
process.env.MUSICBRAINZ_CONTACT = "synthetic-test@cratecompass.invalid";
process.env.DISCOVERY_PROVIDER = "listenbrainz";
delete process.env.LISTENBRAINZ_USER_TOKEN;
delete process.env.LISTENBRAINZ_SIMILARITY_ALGORITHM;
process.env.AI_PROVIDER = "gemini";
process.env.GEMINI_API_KEY = "synthetic-test-key-never-real";
process.env.GEMINI_MODEL = "gemini-synthetic-test-model";
process.env.OPENROUTER_API_KEY = "sk-or-v1-synthetic-test-key-never-real";
process.env.OPENROUTER_MODEL = "synthetic/test-model";
process.env.ANTHROPIC_API_KEY = "sk-ant-synthetic-test-key-never-real";
process.env.ANTHROPIC_MODEL = "claude-opus-5";
process.env.OPENAI_API_KEY = "sk-synthetic-test-key-never-real";
process.env.OPENAI_MODEL = "gpt-synthetic-test-model";
process.env.SPOTIFY_CLIENT_ID = "synthetic-test-client-id";
process.env.SPOTIFY_CLIENT_SECRET = "synthetic-test-client-secret-never-read";
process.env.SPOTIFY_REDIRECT_URI =
  "http://127.0.0.1:3000/api/integrations/spotify/callback";
process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY =
  "c3ludGhldGljLXRlc3Qta2V5LTMyLWJ5dGVzLW9rISE=";
process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY_VERSION = "1";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
});
