// @vitest-environment node

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Database } from "@/types/database";

/**
 * The library against a real database.
 *
 * Two things here cannot be tested honestly with mocks.
 *
 * **Keyset pagination.** A cursor bug shows up as a page that silently drops or
 * repeats a row, and only a real walk across real pages with tied timestamps
 * proves it does neither. The fixture rows are inserted in one statement
 * precisely so their `created_at` values tie — that is the case the id
 * tiebreaker exists for, and a mock would never produce it.
 *
 * **Row Level Security.** The isolation between two listeners is a Postgres
 * policy, not application code, so a mocked client would be testing the mock.
 *
 *     LIVE_DATABASE=1 npx vitest run tests/live/library-database.test.ts
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

const repository = await import("@/features/library/repository");
const mutations = await import("@/features/library/mutations");
const privacy = await import("@/lib/privacy/user-data");

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
  const email = `library-${label}-${Date.now()}@cratecompass.test`;
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

function as(listener: Listener): void {
  currentToken = listener.accessToken;
}

/**
 * Inserts every row in one statement, so the timestamps tie.
 *
 * That is deliberate: tied `created_at` values are exactly the case a keyset
 * without an id tiebreaker gets wrong, and inserting one at a time would give
 * distinct timestamps and hide the bug.
 */
async function seedFavorites(listener: Listener, count: number): Promise<void> {
  const client = createSupabaseClient<Database>(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${listener.accessToken}` } },
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  const { error } = await client.from("favorite_discoveries").insert(
    Array.from({ length: count }, (_, index) => ({
      user_id: listener.id,
      artist_name: `Artist ${String(index).padStart(3, "0")}`,
      source_type: "artist" as const,
      tags: index % 2 === 0 ? ["trip hop"] : ["ambient", "trip hop"],
    })),
  );

  if (error) {
    throw new Error(`Could not seed favourites: ${error.message}`);
  }
}

describe.runIf(live)("library against a real database", () => {
  beforeAll(async () => {
    owner = await createListener("owner");
    other = await createListener("other");
    await seedFavorites(owner, 60);
    await seedFavorites(other, 3);
  }, 60_000);

  afterAll(async () => {
    if (owner) await admin.auth.admin.deleteUser(owner.id);
    if (other) await admin.auth.admin.deleteUser(other.id);
  });

  it("walks every row exactly once across pages", async () => {
    as(owner);

    const seen: string[] = [];
    let cursor: string | null = null;

    for (let page = 0; page < 10; page += 1) {
      const result = await repository.readLibraryPage({
        userId: owner.id,
        sort: "newest",
        cursor,
        search: null,
        entity: "all",
        tags: [],
      });

      seen.push(...result.items.map((item) => item.id));
      cursor = result.nextCursor;

      if (!cursor) break;
    }

    // The assertion the id tiebreaker exists for. Sixty rows sharing a
    // timestamp: without it, pages overlap or skip.
    expect(seen).toHaveLength(60);
    expect(new Set(seen).size).toBe(60);
  }, 60_000);

  it("walks alphabetically without repeating or dropping a row", async () => {
    as(owner);

    const seen: string[] = [];
    let cursor: string | null = null;

    for (let page = 0; page < 10; page += 1) {
      const result = await repository.readLibraryPage({
        userId: owner.id,
        sort: "alphabetical",
        cursor,
        search: null,
        entity: "all",
        tags: [],
      });

      seen.push(...result.items.map((item) => item.artistName));
      cursor = result.nextCursor;

      if (!cursor) break;
    }

    expect(seen).toHaveLength(60);
    expect([...seen]).toEqual([...seen].sort());
  }, 60_000);

  it("counts what the page shows, not something else", async () => {
    as(owner);

    const result = await repository.readLibraryPage({
      userId: owner.id,
      sort: "newest",
      cursor: null,
      search: null,
      entity: "all",
      tags: ["ambient"],
    });

    // Half the seeded rows carry the ambient tag.
    expect(result.matching).toBe(30);
    expect(result.total).toBe(60);
  }, 30_000);

  it("filters tags with AND, not OR", async () => {
    as(owner);

    const both = await repository.readLibraryPage({
      userId: owner.id,
      sort: "newest",
      cursor: null,
      search: null,
      entity: "all",
      tags: ["ambient", "trip hop"],
    });

    // Every row has "trip hop"; only half also have "ambient". OR would match
    // all sixty and read as a filter that does nothing.
    expect(both.matching).toBe(30);
  }, 30_000);

  it("shows a listener only their own library", async () => {
    as(other);

    const result = await repository.readLibraryPage({
      userId: other.id,
      sort: "newest",
      cursor: null,
      search: null,
      entity: "all",
      tags: [],
    });

    expect(result.total).toBe(3);
  }, 30_000);

  it("refuses to return another listener's rows even when asked for them", async () => {
    // Signed in as `other`, asking for `owner`'s id. RLS is the authority, so
    // the explicit filter being wrong must not be enough to leak anything.
    as(other);

    const result = await repository.readLibraryPage({
      userId: owner.id,
      sort: "newest",
      cursor: null,
      search: null,
      entity: "all",
      tags: [],
    });

    expect(result.items).toHaveLength(0);
    expect(result.matching).toBe(0);
  }, 30_000);

  it("normalises tags written through the repository", async () => {
    as(owner);

    const page = await repository.readLibraryPage({
      userId: owner.id,
      sort: "newest",
      cursor: null,
      search: null,
      entity: "all",
      tags: [],
    });

    const target = page.items[0];
    expect(target).toBeDefined();
    if (!target) return;

    await mutations.updateTags({
      userId: owner.id,
      id: target.id,
      tags: ["  Shoegaze  ", "SHOEGAZE", "shoegaze"],
    });

    const vocabulary = await repository.readTagVocabulary(owner.id);

    expect(vocabulary).toContain("shoegaze");
    expect(vocabulary.filter((tag) => tag === "shoegaze")).toHaveLength(1);
  }, 30_000);

  it("removes a row entirely, and can add it back as a new row", async () => {
    as(owner);

    const before = await repository.readLibraryPage({
      userId: owner.id,
      sort: "newest",
      cursor: null,
      search: null,
      entity: "all",
      tags: [],
    });

    const target = before.items[0];
    expect(target).toBeDefined();
    if (!target) return;

    const removed = await mutations.removeFavorite({
      userId: owner.id,
      id: target.id,
    });

    expect(removed).not.toBeNull();
    if (!removed) return;

    const afterRemoval = await repository.readLibraryPage({
      userId: owner.id,
      sort: "newest",
      cursor: null,
      search: null,
      entity: "all",
      tags: [],
    });

    expect(afterRemoval.total).toBe(before.total - 1);

    const restored = await mutations.restoreFavorite({
      userId: owner.id,
      favorite: removed,
    });

    expect(restored).toBe(true);

    const afterRestore = await repository.readLibraryPage({
      userId: owner.id,
      sort: "newest",
      cursor: null,
      search: null,
      entity: "all",
      tags: [],
    });

    expect(afterRestore.total).toBe(before.total);

    // A new row, not the old one resurrected: the id changed, which is the
    // honest consequence of having actually deleted it.
    expect(afterRestore.items.map((item) => item.id)).not.toContain(target.id);
  }, 60_000);

  it("enumerates the owner's data and nothing of anyone else's", async () => {
    const exported = await privacy.collectUserData(other.id);

    expect(exported).not.toBeNull();
    expect(exported?.tables.favorite_discoveries).toHaveLength(3);

    // The owner has sixty; none may appear in another listener's export.
    const names = JSON.stringify(exported?.tables.favorite_discoveries ?? []);
    expect(names).not.toContain("Artist 059");
  }, 30_000);
});
