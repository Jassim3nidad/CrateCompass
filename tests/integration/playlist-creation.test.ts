import { beforeEach, describe, expect, it, vi } from "vitest";

import { SpotifyProviderError } from "@/lib/providers/spotify/types";

/**
 * The creation state machine, with Spotify and the database mocked.
 *
 * This is the first irreversible outward action in the product, so the
 * assertions are about what happens when things go wrong: a retry must not
 * create a second playlist, a failure before Spotify must leave nothing behind,
 * and a playlist that exists must never be reported as if it does not.
 */

const mocks = vi.hoisted(() => ({
  readDraft: vi.fn(),
  claimIdempotencyKey: vi.fn(),
  completeIdempotencyKey: vi.fn(),
  releaseIdempotencyKey: vi.fn(),
  markCreating: vi.fn(),
  markDraftFailed: vi.fn(),
  recordCreationOutcome: vi.fn(),
  updateTrackResolution: vi.fn(),
  getAccessToken: vi.fn(),
  search: vi.fn(),
  createPlaylist: vi.fn(),
  addPlaylistItems: vi.fn(),
}));

vi.mock("@/features/playlists/repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/playlists/repository")>()),
  readDraft: mocks.readDraft,
  claimIdempotencyKey: mocks.claimIdempotencyKey,
  completeIdempotencyKey: mocks.completeIdempotencyKey,
  releaseIdempotencyKey: mocks.releaseIdempotencyKey,
  markCreating: mocks.markCreating,
  markDraftFailed: mocks.markDraftFailed,
  recordCreationOutcome: mocks.recordCreationOutcome,
  updateTrackResolution: mocks.updateTrackResolution,
}));

vi.mock("@/lib/providers/spotify", () => ({
  getSpotifyPort: () => ({
    getAccessToken: mocks.getAccessToken,
    search: mocks.search,
    createPlaylist: mocks.createPlaylist,
    addPlaylistItems: mocks.addPlaylistItems,
  }),
}));

const { createPlaylistFromDraft } =
  await import("@/features/playlists/creation");

const USER = "11111111-1111-4111-8111-111111111111";
const PLAYLIST = "22222222-2222-4222-8222-222222222222";

function draftWith(trackCount: number) {
  return {
    playlistId: PLAYLIST,
    title: "Rainy commute",
    description: "Built from a hopeful prompt.",
    isPublic: false,
    status: "draft",
    tracks: Array.from({ length: trackCount }, (_, index) => ({
      id: `track-${index}`,
      position: index + 1,
      recordingMbid: `rec-${index}`,
      artistMbid: `artist-${index}`,
      title: `Track ${index}`,
      artistName: `Artist ${index}`,
      releaseTitle: "Album",
      status: "pending",
      spotifyUri: null,
    })),
  };
}

function spotifyMatch(index: number) {
  return {
    id: `spotify-${index}`,
    uri: `spotify:track:${index}`,
    name: `Track ${index}`,
    artistNames: [`Artist ${index}`],
    isExplicit: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readDraft.mockResolvedValue(draftWith(2));
  mocks.claimIdempotencyKey.mockResolvedValue({ outcome: "claimed" });
  mocks.getAccessToken.mockResolvedValue("access-token");
  mocks.markCreating.mockResolvedValue(true);
  mocks.createPlaylist.mockResolvedValue({
    id: "playlist-1",
    uri: "spotify:playlist:1",
  });
  mocks.addPlaylistItems.mockResolvedValue("snapshot");
  mocks.search.mockImplementation(
    async (_token: string, input: { query: string }) => {
      const index = /Track (\d+)/.exec(input.query)?.[1];
      return {
        artists: [],
        tracks: index ? [spotifyMatch(Number(index))] : [],
      };
    },
  );
});

const request = {
  userId: USER,
  playlistId: PLAYLIST,
  idempotencyKey: "key-1234567890",
  avoidExplicit: false,
};

describe("playlist creation", () => {
  it("creates the playlist and reports the tracks added", async () => {
    const result = await createPlaylistFromDraft(request);

    expect(result.status).toBe("created");
    expect(result.status === "created" && result.tracksAdded).toBe(2);
    expect(mocks.createPlaylist).toHaveBeenCalledTimes(1);
    expect(mocks.completeIdempotencyKey).toHaveBeenCalledTimes(1);
  });

  it("returns the original result on a replayed submission", async () => {
    const original = {
      status: "created",
      playlistUrl: "https://open.spotify.com/playlist/playlist-1",
      trackTotal: 2,
      tracksAdded: 2,
    };
    mocks.claimIdempotencyKey.mockResolvedValue({
      outcome: "replay",
      response: original,
    });

    const result = await createPlaylistFromDraft(request);

    expect(result).toEqual(original);
    // The point of the test: no second playlist in the listener's account.
    expect(mocks.createPlaylist).not.toHaveBeenCalled();
  });

  it("refuses a concurrent submission rather than racing it", async () => {
    mocks.claimIdempotencyKey.mockResolvedValue({ outcome: "in-progress" });

    const result = await createPlaylistFromDraft(request);

    expect(result.status).toBe("in-progress");
    expect(mocks.createPlaylist).not.toHaveBeenCalled();
  });

  it("refuses a reused key carrying different contents", async () => {
    mocks.claimIdempotencyKey.mockResolvedValue({ outcome: "conflict" });

    const result = await createPlaylistFromDraft(request);

    expect(result.status).toBe("failed");
    expect(mocks.createPlaylist).not.toHaveBeenCalled();
  });

  it("releases the key when the connection is missing, so a retry is possible", async () => {
    mocks.getAccessToken.mockRejectedValue(
      new SpotifyProviderError("reauthorization-required", "no connection"),
    );

    const result = await createPlaylistFromDraft(request);

    expect(result.status).toBe("spotify-not-connected");
    expect(mocks.releaseIdempotencyKey).toHaveBeenCalledTimes(1);
    expect(mocks.createPlaylist).not.toHaveBeenCalled();
  });

  it("explains a missing scope with the reconnect copy", async () => {
    mocks.getAccessToken.mockRejectedValue(
      new SpotifyProviderError("insufficient-scope", "missing scope"),
    );

    const result = await createPlaylistFromDraft(request);

    expect(result.status).toBe("reconnect-required");
    expect(result.status === "reconnect-required" && result.message).toMatch(
      /added public playlists after you connected/,
    );
  });

  it("creates nothing when no track resolves", async () => {
    mocks.search.mockResolvedValue({ artists: [], tracks: [] });

    const result = await createPlaylistFromDraft(request);

    expect(result.status).toBe("failed");
    expect(mocks.createPlaylist).not.toHaveBeenCalled();
    // The key is released: nothing was created, so a retry is legitimate.
    expect(mocks.releaseIdempotencyKey).toHaveBeenCalledTimes(1);
  });

  it("reports a partial result when one track cannot be matched", async () => {
    mocks.search.mockImplementation(
      async (_token: string, input: { query: string }) => {
        const index = /Track (\d+)/.exec(input.query)?.[1];
        return index === "0"
          ? { artists: [], tracks: [spotifyMatch(0)] }
          : { artists: [], tracks: [] };
      },
    );

    const result = await createPlaylistFromDraft(request);

    expect(result.status).toBe("partial");
    expect(result.status === "partial" && result.tracksAdded).toBe(1);
    expect(result.status === "partial" && result.unresolved).toHaveLength(1);
    // The playlist exists, so the listener is given the link regardless.
    expect(result.status === "partial" && result.playlistUrl).toContain(
      "playlist-1",
    );
  });

  it("reports a created playlist as partial when adding items fails", async () => {
    mocks.addPlaylistItems.mockRejectedValue(
      new SpotifyProviderError("rate-limited", "slow down"),
    );

    const result = await createPlaylistFromDraft(request);

    // Never "failed": the playlist is in the account and the listener can see it.
    expect(result.status).toBe("partial");
    expect(result.status === "partial" && result.tracksAdded).toBe(0);
    expect(mocks.recordCreationOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ status: "partial" }),
    );
  });

  it("passes the chosen visibility to Spotify", async () => {
    mocks.readDraft.mockResolvedValue({ ...draftWith(1), isPublic: true });

    await createPlaylistFromDraft(request);

    expect(mocks.createPlaylist).toHaveBeenCalledWith(
      "access-token",
      expect.objectContaining({ isPublic: true }),
    );
  });

  it("refuses an empty draft before claiming a key", async () => {
    mocks.readDraft.mockResolvedValue(draftWith(0));

    const result = await createPlaylistFromDraft(request);

    expect(result.status).toBe("failed");
    expect(mocks.claimIdempotencyKey).not.toHaveBeenCalled();
  });
});
