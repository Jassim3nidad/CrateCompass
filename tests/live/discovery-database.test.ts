// @vitest-environment node
//
// Node rather than jsdom: this file talks to Postgres over HTTP and constructs
// service-role clients, neither of which belongs in a browser-like environment.

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { Database } from "@/types/database";

/**
 * The discovery repository against a real database.
 *
 * Fixtures and mocks cannot answer the question this file exists for: does Row
 * Level Security actually stop one listener reading or deleting another's
 * discovery decisions? The pgTAP suite asserts the policies from inside
 * Postgres; this asserts the same boundary from inside the application code
 * that runs in production, using two real signed-in users.
 *
 *     LIVE_DATABASE=1 npx vitest run tests/live/discovery-database.test.ts
 *
 * Requires a local stack (`supabase start`). Skipped otherwise, so `npm test`
 * stays offline.
 *
 * These are the standard local development keys — identical on every machine,
 * published in Supabase's own documentation, and worthless outside 127.0.0.1.
 */

const live = process.env.LIVE_DATABASE === "1";

const SUPABASE_URL = process.env.LOCAL_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY =
  process.env.LOCAL_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE_ROLE_KEY =
  process.env.LOCAL_SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const SEED_MBID = "f1000000-0000-4000-8000-000000000001";
const CANDIDATE_MBID = "f2000000-0000-4000-8000-000000000001";

interface Listener {
  readonly id: string;
  readonly email: string;
  readonly accessToken: string;
}

/**
 * The repository builds its client through `lib/supabase/server`, which needs
 * Next's request-scoped `cookies()`. Substituting a token-bearing client keeps
 * every line of repository code under test while making the session explicit:
 * RLS still evaluates `auth.uid()` from the JWT, so the boundary being measured
 * is the real one.
 */
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

const repository = await import("@/features/discovery/repository");

const admin = createSupabaseClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});

let listenerOne: Listener;
let listenerTwo: Listener;

async function createListener(label: string): Promise<Listener> {
  const email = `discovery-${label}-${Date.now()}@cratecompass.test`;
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

  return {
    id: data.user.id,
    email,
    accessToken: signIn.data.session.access_token,
  };
}

function actingAs(listener: Listener): void {
  currentToken = listener.accessToken;
}

/**
 * A client bound to one listener's session, for verification reads.
 *
 * The service-role client cannot be used for these: the Phase 2 schema grants
 * table privileges to `authenticated` alone, so `service_role` has none — a
 * tighter posture than the Supabase default, and one worth not undoing for the
 * convenience of a test.
 */
function clientFor(listener: Listener) {
  return createSupabaseClient<Database>(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${listener.accessToken}` } },
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

async function rowsFor(
  listener: Listener,
  table: "favorite_discoveries" | "dismissed_discoveries",
): Promise<readonly { id: string }[]> {
  const { data, error } = await clientFor(listener).from(table).select("id");

  if (error) throw new Error(`${table} read failed: ${error.message}`);

  return data;
}

describe.runIf(live)("discovery repository against a real database", () => {
  beforeAll(async () => {
    listenerOne = await createListener("one");
    listenerTwo = await createListener("two");
  }, 60_000);

  afterAll(async () => {
    for (const listener of [listenerOne, listenerTwo]) {
      if (listener) await admin.auth.admin.deleteUser(listener.id);
    }
  }, 60_000);

  beforeEach(async () => {
    // Each listener clears their own rows; RLS means neither can clear the
    // other's, which is exactly the property under test.
    for (const listener of [listenerOne, listenerTwo]) {
      const client = clientFor(listener);
      await client
        .from("dismissed_discoveries")
        .delete()
        .eq("user_id", listener.id);
      await client
        .from("favorite_discoveries")
        .delete()
        .eq("user_id", listener.id);
    }
  });

  it("saves an artist and treats a second save as a no-op", async () => {
    actingAs(listenerOne);

    await expect(
      repository.saveDiscoveredArtist({
        userId: listenerOne.id,
        mbid: CANDIDATE_MBID,
        name: "Vellum Coast",
        sourceReference: "https://listenbrainz.org/artist/vellum",
      }),
    ).resolves.toBe("saved");

    // The partial unique index, exercised through the application path: a
    // double submit must not create a second favourite.
    await expect(
      repository.saveDiscoveredArtist({
        userId: listenerOne.id,
        mbid: CANDIDATE_MBID,
        name: "Vellum Coast",
        sourceReference: null,
      }),
    ).resolves.toBe("already-present");

    expect(await rowsFor(listenerOne, "favorite_discoveries")).toHaveLength(1);
  }, 30_000);

  it("keeps saved artists invisible to another listener", async () => {
    actingAs(listenerOne);
    await repository.saveDiscoveredArtist({
      userId: listenerOne.id,
      mbid: CANDIDATE_MBID,
      name: "Vellum Coast",
      sourceReference: null,
    });

    actingAs(listenerOne);
    await expect(
      repository.readSavedCandidates({
        userId: listenerOne.id,
        mbids: [CANDIDATE_MBID],
      }),
    ).resolves.toEqual(new Set([CANDIDATE_MBID]));

    actingAs(listenerTwo);
    await expect(
      repository.readSavedCandidates({
        userId: listenerTwo.id,
        mbids: [CANDIDATE_MBID],
      }),
    ).resolves.toEqual(new Set());
  }, 30_000);

  it("dismisses, restores, and refuses a duplicate dismissal", async () => {
    actingAs(listenerOne);

    await expect(
      repository.dismissCandidate({
        userId: listenerOne.id,
        seedMbid: SEED_MBID,
        candidateMbid: CANDIDATE_MBID,
        candidateName: "Vellum Coast",
      }),
    ).resolves.toBe("saved");

    await expect(
      repository.dismissCandidate({
        userId: listenerOne.id,
        seedMbid: SEED_MBID,
        candidateMbid: CANDIDATE_MBID,
        candidateName: "Vellum Coast",
      }),
    ).resolves.toBe("already-present");

    await expect(
      repository.readDismissedCandidates({
        userId: listenerOne.id,
        seedMbid: SEED_MBID,
      }),
    ).resolves.toEqual(new Set([CANDIDATE_MBID]));

    await expect(
      repository.restoreCandidate({
        userId: listenerOne.id,
        seedMbid: SEED_MBID,
        candidateMbid: CANDIDATE_MBID,
      }),
    ).resolves.toBe(true);

    await expect(
      repository.readDismissedCandidates({
        userId: listenerOne.id,
        seedMbid: SEED_MBID,
      }),
    ).resolves.toEqual(new Set());
  }, 30_000);

  it("hides one listener's dismissals from another", async () => {
    actingAs(listenerOne);
    await repository.dismissCandidate({
      userId: listenerOne.id,
      seedMbid: SEED_MBID,
      candidateMbid: CANDIDATE_MBID,
      candidateName: "Vellum Coast",
    });

    actingAs(listenerTwo);
    await expect(
      repository.readDismissedCandidates({
        userId: listenerTwo.id,
        seedMbid: SEED_MBID,
      }),
    ).resolves.toEqual(new Set());

    // Reading with the *other* listener's id in the filter is the attack this
    // guards: the filter is not the control, the policy is.
    await expect(
      repository.readDismissedCandidates({
        userId: listenerOne.id,
        seedMbid: SEED_MBID,
      }),
    ).resolves.toEqual(new Set());
  }, 30_000);

  it("cannot delete another listener's dismissal", async () => {
    actingAs(listenerOne);
    await repository.dismissCandidate({
      userId: listenerOne.id,
      seedMbid: SEED_MBID,
      candidateMbid: CANDIDATE_MBID,
      candidateName: "Vellum Coast",
    });

    actingAs(listenerTwo);
    await repository.restoreCandidate({
      userId: listenerOne.id,
      seedMbid: SEED_MBID,
      candidateMbid: CANDIDATE_MBID,
    });

    // The delete is allowed to run and simply matches nothing. What matters is
    // the row still being there afterwards.
    expect(await rowsFor(listenerOne, "dismissed_discoveries")).toHaveLength(1);

    actingAs(listenerOne);
    await expect(
      repository.readDismissedCandidates({
        userId: listenerOne.id,
        seedMbid: SEED_MBID,
      }),
    ).resolves.toEqual(new Set([CANDIDATE_MBID]));
  }, 30_000);

  it("cannot save on another listener's behalf", async () => {
    actingAs(listenerTwo);

    // The insert names listener one as the owner while the JWT says otherwise,
    // which the WITH CHECK policy must refuse.
    await expect(
      repository.saveDiscoveredArtist({
        userId: listenerOne.id,
        mbid: CANDIDATE_MBID,
        name: "Vellum Coast",
        sourceReference: null,
      }),
    ).resolves.toBe("failed");

    expect(await rowsFor(listenerOne, "favorite_discoveries")).toHaveLength(0);
  }, 30_000);

  it("removes a saved artist for its owner only", async () => {
    actingAs(listenerOne);
    await repository.saveDiscoveredArtist({
      userId: listenerOne.id,
      mbid: CANDIDATE_MBID,
      name: "Vellum Coast",
      sourceReference: null,
    });

    actingAs(listenerTwo);
    await repository.removeSavedArtist({
      userId: listenerOne.id,
      mbid: CANDIDATE_MBID,
    });

    expect(await rowsFor(listenerOne, "favorite_discoveries")).toHaveLength(1);

    actingAs(listenerOne);
    await expect(
      repository.removeSavedArtist({
        userId: listenerOne.id,
        mbid: CANDIDATE_MBID,
      }),
    ).resolves.toBe(true);

    expect(await rowsFor(listenerOne, "favorite_discoveries")).toHaveLength(0);
  }, 30_000);
});
