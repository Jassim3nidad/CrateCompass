import "server-only";

/**
 * Central MusicBrainz request pacer.
 *
 * MusicBrainz allows an average of one request per second per IP address and
 * answers 503 to everything above it. Pacing has to be global rather than
 * per-call-site, so every request funnels through this single queue: requests
 * are serialised and spaced, and a burst of concurrent callers becomes an
 * orderly line instead of a 503 storm.
 */

const MINIMUM_INTERVAL_MS = 1000;

let queue: Promise<unknown> = Promise.resolve();
let nextAllowedAt = 0;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function paced<T>(operation: () => Promise<T>): Promise<T> {
  const scheduled = queue.then(async () => {
    const wait = nextAllowedAt - Date.now();
    if (wait > 0) {
      await sleep(wait);
    }

    nextAllowedAt = Date.now() + MINIMUM_INTERVAL_MS;
    return operation();
  });

  // The queue tracks completion order only. A rejected operation must not
  // break the chain for everyone behind it.
  queue = scheduled.then(
    () => undefined,
    () => undefined,
  );

  return scheduled;
}

/** Test-only: forget the pacing window so specs do not wait on real seconds. */
export function resetPacerForTesting(): void {
  queue = Promise.resolve();
  nextAllowedAt = 0;
}

export const PACER_INTERVAL_MS = MINIMUM_INTERVAL_MS;
