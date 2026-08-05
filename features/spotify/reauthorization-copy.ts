/**
 * Copy for the reconnect caused by the added public-playlist scope.
 *
 * Kept in one module, rendered verbatim, because it is under review — see
 * docs/product/phase-7-reauthorization-copy.md. Editing the wording should be
 * a one-file change, not a hunt through components.
 *
 * The thing this copy exists to prevent: a listener reading "missing
 * permission" and concluding the product is broken. Nothing is broken. The
 * scope set widened after they connected, and they are being asked for one
 * additional permission they may reasonably decline.
 */

export const REAUTHORIZATION_COPY = {
  connections: {
    heading: "Reconnect to finish setting up playlists",
    body: "CrateCompass can now create public playlists as well as private ones, which needs one additional permission from Spotify. Your connection was set up before that change, so Spotify has not been asked for it yet.",
    reassurance:
      "Nothing is broken and nothing you have saved is affected. Playlists already in your Spotify account stay exactly as they are. Reconnecting takes you to Spotify to approve the same connection with the extra permission.",
    action: "Reconnect Spotify",
    decline:
      "Prefer to keep it as it is? Discovery, explanations and your library all keep working. Only playlist creation needs the reconnect.",
  },

  playlistBlocked: {
    heading: "This playlist needs a reconnect first",
    body: "Creating a playlist needs a Spotify permission your connection does not have yet, because CrateCompass added public playlists after you connected.",
    // Truthful because the draft is a server-side record owned by the user, not
    // component state. If that ever changes, this sentence changes with it.
    reassurance:
      "Your draft is kept. Reconnect, and you will come straight back to it.",
    action: "Reconnect Spotify",
    dismiss: "Keep editing",
  },

  declined: {
    heading: "Spotify did not grant the playlist permission",
    body: "No connection was changed, and your existing one still works for everything except creating playlists. You can try again whenever you like.",
  },

  /** Shown once the connection carries both scopes. */
  connectedSummary:
    "CrateCompass can create private and public playlists in this Spotify account, and only when you explicitly approve one. New playlists are private unless you choose otherwise.",
} as const;
