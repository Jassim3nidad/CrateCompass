import "server-only";

import { getServerEnvironment } from "@/lib/env";

/**
 * The fixture gate, on its own so it can be imported cheaply.
 *
 * Kept apart from `lib/providers/fixtures/index.ts` because the AI factory and
 * the Spotify factory both need to ask this question, and importing the module
 * that holds the invented catalogue would drag MusicBrainz and discovery types
 * into both of their dependency trees for the sake of one boolean.
 *
 * The environment schema refuses to validate `PROVIDER_FIXTURES=1` unless
 * `APP_ENV` is `test`, so a deployment carrying the flag fails to start rather
 * than quietly serving invented data.
 */
export function areProviderFixturesEnabled(): boolean {
  return getServerEnvironment().PROVIDER_FIXTURES === "1";
}
