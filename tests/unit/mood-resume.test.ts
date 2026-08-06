import { describe, expect, it } from "vitest";

import {
  buildResumePath,
  resumeParamsSchema,
  resumedControls,
  toResumableDraft,
} from "@/features/mood/resume";
import type { StoredDraft } from "@/features/playlists/repository";
import { DEFAULT_CONTROLS, PLAYLIST_LENGTH } from "@/lib/mood/controls";

/**
 * The defect these tests exist to prevent recurring.
 *
 * The reconnect prompt promised "your draft is kept — reconnect and you will
 * come straight back to it" while the workflow held the draft in `useState` and
 * the page rendered it with no props. The row survived; nothing pointed back at
 * it. These assertions cover the round trip that makes the sentence true, and
 * in particular the two settings that are not columns on the draft.
 */

const PLAYLIST_ID = "8f5c2c1e-0e2a-4a5f-9a1b-2c3d4e5f6a7b";

function storedDraftWith(overrides: Partial<StoredDraft> = {}): StoredDraft {
  return {
    playlistId: PLAYLIST_ID,
    title: "Hopeful rain",
    description: "For the commute.",
    moodText: "rainy commute but I need something hopeful",
    isPublic: false,
    status: "draft",
    tracks: [
      {
        id: "6d1f0b3a-7c8e-4d2f-9a0b-1c2d3e4f5a6b",
        position: 1,
        recordingMbid: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
        artistMbid: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
        title: "Glory Box",
        artistName: "Portishead",
        releaseTitle: "Dummy",
        status: "pending",
        spotifyUri: null,
      },
    ],
    ...overrides,
  };
}

describe("resume path", () => {
  it("carries the draft and the two settings that are not stored on it", () => {
    const path = buildResumePath({
      playlistId: PLAYLIST_ID,
      controls: { length: 30, explicitContent: "avoid" },
    });

    const url = new URL(path, "https://cratecompass.invalid");

    expect(url.pathname).toBe("/mood");
    expect(url.searchParams.get("draft")).toBe(PLAYLIST_ID);
    expect(url.searchParams.get("length")).toBe("30");
    expect(url.searchParams.get("explicit")).toBe("avoid");
  });

  it("clamps a length that is outside the supported range", () => {
    const path = buildResumePath({
      playlistId: PLAYLIST_ID,
      controls: { length: 5000, explicitContent: "allow" },
    });

    expect(new URL(path, "https://x.invalid").searchParams.get("length")).toBe(
      String(PLAYLIST_LENGTH.max),
    );
  });

  it("round-trips through the schema the page parses with", () => {
    const path = buildResumePath({
      playlistId: PLAYLIST_ID,
      controls: { length: 25, explicitContent: "avoid" },
    });

    const params = Object.fromEntries(
      new URL(path, "https://x.invalid").searchParams,
    );
    const parsed = resumeParamsSchema.safeParse(params);

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.draft).toBe(PLAYLIST_ID);
    expect(parsed.success && parsed.data.length).toBe(25);
    expect(parsed.success && parsed.data.explicit).toBe("avoid");
  });

  it("rejects a draft identifier that is not a uuid", () => {
    expect(resumeParamsSchema.safeParse({ draft: "../admin" }).success).toBe(
      false,
    );
  });

  it("ignores a repeated parameter rather than reading the first", () => {
    // Next supplies string[] for a repeated key. Accepting it would mean the
    // schema and the database disagree about which draft is being resumed.
    expect(
      resumeParamsSchema.safeParse({ draft: [PLAYLIST_ID, PLAYLIST_ID] })
        .success,
    ).toBe(false);
  });
});

describe("resumed controls", () => {
  it("preserves an explicit-content choice across the round trip", () => {
    const controls = resumedControls({
      params: { draft: PLAYLIST_ID, length: 20, explicit: "avoid" },
      isPublic: false,
    });

    expect(controls.explicitContent).toBe("avoid");
  });

  it("takes visibility from the stored row, not the URL", () => {
    const controls = resumedControls({
      params: { draft: PLAYLIST_ID },
      isPublic: true,
    });

    expect(controls.isPublic).toBe(true);
  });

  it("falls back to defaults when the settings are absent", () => {
    const controls = resumedControls({
      params: { draft: PLAYLIST_ID },
      isPublic: false,
    });

    expect(controls.length).toBe(DEFAULT_CONTROLS.length);
    expect(controls.explicitContent).toBe(DEFAULT_CONTROLS.explicitContent);
  });
});

describe("resumable draft", () => {
  it("restores the tracks and the listener's own words", () => {
    const resumed = toResumableDraft({
      stored: storedDraftWith(),
      controls: DEFAULT_CONTROLS,
    });

    expect(resumed).not.toBeNull();
    expect(resumed?.moodText).toBe(
      "rainy commute but I need something hopeful",
    );
    expect(resumed?.draft.status).toBe("ready");
    expect(
      resumed?.draft.status === "ready" && resumed.draft.tracks[0]?.title,
    ).toBe("Glory Box");
  });

  it("reports a short draft against the requested length", () => {
    const resumed = toResumableDraft({
      stored: storedDraftWith(),
      controls: { ...DEFAULT_CONTROLS, length: 20 },
    });

    expect(resumed?.draft.status === "ready" && resumed.draft.isShort).toBe(
      true,
    );
  });

  it.each(["creating", "created", "partial", "failed"])(
    "refuses to resume a draft that has moved to %s",
    (status) => {
      // Rendering one of these with a "Create playlist" button would invite a
      // second creation of something that already exists in Spotify.
      expect(
        toResumableDraft({
          stored: storedDraftWith({ status }),
          controls: DEFAULT_CONTROLS,
        }),
      ).toBeNull();
    },
  );

  it("refuses to resume a draft with no tracks left", () => {
    expect(
      toResumableDraft({
        stored: storedDraftWith({ tracks: [] }),
        controls: DEFAULT_CONTROLS,
      }),
    ).toBeNull();
  });

  it("claims no artists were skipped, because that is not recorded", () => {
    const resumed = toResumableDraft({
      stored: storedDraftWith(),
      controls: DEFAULT_CONTROLS,
    });

    expect(
      resumed?.draft.status === "ready" && resumed.draft.artistsWithoutTracks,
    ).toEqual([]);
  });
});
