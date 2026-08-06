// @vitest-environment node

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Database } from "@/types/database";

/**
 * Draft persistence and the idempotency RPCs against a real database.
 *
 * These are the parts of Phase 7 that mocks cannot honestly cover: the
 * duplicate protection is a Postgres function reached with a service-role key
 * over a schema PostgREST does not expose, and the draft tables are governed by
 * RLS. A mocked version of either would be testing the mock.
 *
 *     LIVE_DATABASE=1 npx vitest run tests/live/playlist-database.test.ts
 *
 * Requires a local stack. Skipped otherwise, so `npm test` stays offline.
 */

const live = process.env.LIVE_DATABASE === "1";

const SUPABASE_URL = process.env.LOCAL_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY =
  process.env.LOCAL_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE_ROLE_KEY =
  process.env.LOCAL_SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

let currentToken = "";

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () =>
    createSupabaseClient<Database>(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${currentToken}` } },
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () =>
    createSupabaseClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    }),
}));

const repository = await import("@/features/playlists/repository");

const admin = createSupabaseClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});

interface Listener {
  readonly id: string;
  readonly accessToken: string;
}

let owner: Listener;
let other: Listener;

async function createListener(label: string): Promise<Listener> {
  const email = `playlist-${label}-${Date.now()}@cratecompass.test`;
  const password = `synthetic-local-only-${label}-password`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error || !data.user) {
    throw new Error(`Could not create ${label}: ${error?.message}`);
  }

  const anon = createSupabaseClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  const signIn = await anon.auth.signInWithPassword({ email, password });

  if (signIn.error || !signIn.data.session) {
    throw new Error(`Could not sign in ${label}: ${signIn.error?.message}`);
  }

  return { id: data.user.id, accessToken: signIn.data.session.access_token };
}

function tracks(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    position: index + 1,
    recordingMbid: `rec-${index}`,
    artistMbid: `artist-${index}`,
    title: `Track ${index}`,
    artistName: `Artist ${index}`,
    releaseTitle: "Album",
  }));
}

describe.runIf(live)("playlist persistence against a real database", () => {
  beforeAll(async () => {
    owner = await createListener("owner");
    other = await createListener("other");
  }, 60_000);

  afterAll(async () => {
    for (const listener of [owner, other]) {
      if (listener) await admin.auth.admin.deleteUser(listener.id);
    }
  }, 60_000);

  it("saves a draft with its tracks and reads it back in order", async () => {
    currentToken = owner.accessToken;

    const playlistId = await repository.saveDraft({
      userId: owner.id,
      moodText: "rainy commute but hopeful",
      title: "Rainy commute",
      description: "Built from a hopeful prompt.",
      isPublic: false,
      tracks: tracks(3),
    });

    expect(playlistId).toBeTruthy();

    const draft = await repository.readDraft({
      userId: owner.id,
      playlistId: playlistId!,
    });

    expect(draft?.tracks).toHaveLength(3);
    expect(draft?.tracks.map((track) => track.position)).toEqual([1, 2, 3]);
    expect(draft?.isPublic).toBe(false);
    expect(draft?.status).toBe("draft");
  }, 30_000);

  it("hides one listener's draft from another", async () => {
    currentToken = owner.accessToken;
    const playlistId = await repository.saveDraft({
      userId: owner.id,
      moodText: "late night",
      title: "Late night",
      description: "d",
      isPublic: false,
      tracks: tracks(2),
    });

    currentToken = other.accessToken;

    // Reading with the owner's id in the filter is the attack: the filter is
    // not the control, the policy is.
    const stolen = await repository.readDraft({
      userId: owner.id,
      playlistId: playlistId!,
    });

    expect(stolen).toBeNull();
  }, 30_000);

  it("cannot remove a track from another listener's draft", async () => {
    currentToken = owner.accessToken;
    const playlistId = await repository.saveDraft({
      userId: owner.id,
      moodText: "morning",
      title: "Morning",
      description: "d",
      isPublic: false,
      tracks: tracks(2),
    });
    const draft = await repository.readDraft({
      userId: owner.id,
      playlistId: playlistId!,
    });
    const victim = draft!.tracks[0]!;

    currentToken = other.accessToken;
    await repository.removeDraftTrack({
      userId: owner.id,
      playlistId: playlistId!,
      trackId: victim.id,
    });

    currentToken = owner.accessToken;
    const after = await repository.readDraft({
      userId: owner.id,
      playlistId: playlistId!,
    });

    expect(after?.tracks).toHaveLength(2);
  }, 30_000);

  it("claims a key once and reports a replay with the stored response", async () => {
    const key = `key-${Date.now()}`;
    const digest = repository.digestRequest({ playlistId: "a", tracks: [1] });

    const first = await repository.claimIdempotencyKey({
      userId: owner.id,
      operation: "create-playlist",
      key,
      requestDigest: digest,
    });
    expect(first.outcome).toBe("claimed");

    // A second attempt before completion is in-progress, not a fresh claim:
    // this is what stops a double-click creating two playlists.
    const second = await repository.claimIdempotencyKey({
      userId: owner.id,
      operation: "create-playlist",
      key,
      requestDigest: digest,
    });
    expect(second.outcome).toBe("in-progress");

    await repository.completeIdempotencyKey({
      userId: owner.id,
      operation: "create-playlist",
      key,
      response: { status: "created", tracksAdded: 3 },
    });

    const replay = await repository.claimIdempotencyKey({
      userId: owner.id,
      operation: "create-playlist",
      key,
      requestDigest: digest,
    });

    expect(replay.outcome).toBe("replay");
    expect(replay.outcome === "replay" && replay.response).toMatchObject({
      status: "created",
      tracksAdded: 3,
    });
  }, 30_000);

  it("reports a conflict when the same key carries different contents", async () => {
    const key = `key-conflict-${Date.now()}`;

    await repository.claimIdempotencyKey({
      userId: owner.id,
      operation: "create-playlist",
      key,
      requestDigest: repository.digestRequest({ tracks: ["a"] }),
    });

    const conflicting = await repository.claimIdempotencyKey({
      userId: owner.id,
      operation: "create-playlist",
      key,
      requestDigest: repository.digestRequest({ tracks: ["b"] }),
    });

    expect(conflicting.outcome).toBe("conflict");
  }, 30_000);

  it("releases an incomplete claim so a genuine retry can proceed", async () => {
    const key = `key-release-${Date.now()}`;
    const digest = repository.digestRequest({ tracks: ["a"] });

    await repository.claimIdempotencyKey({
      userId: owner.id,
      operation: "create-playlist",
      key,
      requestDigest: digest,
    });

    await repository.releaseIdempotencyKey({
      userId: owner.id,
      operation: "create-playlist",
      key,
    });

    const retry = await repository.claimIdempotencyKey({
      userId: owner.id,
      operation: "create-playlist",
      key,
      requestDigest: digest,
    });

    expect(retry.outcome).toBe("claimed");
  }, 30_000);

  it("keys are per listener, so one cannot block another", async () => {
    const key = `key-shared-${Date.now()}`;
    const digest = repository.digestRequest({ tracks: ["a"] });

    await repository.claimIdempotencyKey({
      userId: owner.id,
      operation: "create-playlist",
      key,
      requestDigest: digest,
    });

    const otherClaim = await repository.claimIdempotencyKey({
      userId: other.id,
      operation: "create-playlist",
      key,
      requestDigest: digest,
    });

    expect(otherClaim.outcome).toBe("claimed");
  }, 30_000);

  it("records a partial creation outcome the listener can act on", async () => {
    currentToken = owner.accessToken;
    const playlistId = await repository.saveDraft({
      userId: owner.id,
      moodText: "partial",
      title: "Partial",
      description: "d",
      isPublic: false,
      tracks: tracks(3),
    });

    await repository.recordCreationOutcome({
      userId: owner.id,
      playlistId: playlistId!,
      spotifyPlaylistId: `spotify-${Date.now()}`,
      spotifyUrl: "https://open.spotify.com/playlist/x",
      tracksAdded: 2,
      status: "partial",
      failureCode: "partial-add",
    });

    const draft = await repository.readDraft({
      userId: owner.id,
      playlistId: playlistId!,
    });

    expect(draft?.status).toBe("partial");
  }, 30_000);
});
