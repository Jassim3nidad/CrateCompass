import "server-only";

import {
  DiscoveryProviderError,
  type DiscoveryProvider,
} from "@/lib/providers/discovery/port";
import { createListenBrainzProvider } from "@/lib/providers/discovery/listenbrainz";
import {
  areProviderFixturesEnabled,
  createFixtureDiscoveryProvider,
} from "@/lib/providers/fixtures";
import { getServerEnvironment } from "@/lib/env";

/**
 * The one place the discovery implementation is chosen.
 *
 * Previously this lived inside the ListenBrainz adapter, which meant the
 * selection logic imported the very module it was meant to be able to replace.
 */
export function getDiscoveryProvider(): DiscoveryProvider {
  if (areProviderFixturesEnabled()) {
    return createFixtureDiscoveryProvider();
  }

  const environment = getServerEnvironment();

  if (environment.DISCOVERY_PROVIDER !== "listenbrainz") {
    // ADR 0003 selected ListenBrainz. Last.fm is intentionally unimplemented:
    // its terms prohibit sub-licensing its data to a third party, which makes
    // sending evidence to an AI provider legally ambiguous.
    throw new DiscoveryProviderError(
      "not-configured",
      `Discovery provider "${environment.DISCOVERY_PROVIDER}" is not implemented. Set DISCOVERY_PROVIDER=listenbrainz.`,
    );
  }

  return createListenBrainzProvider();
}
