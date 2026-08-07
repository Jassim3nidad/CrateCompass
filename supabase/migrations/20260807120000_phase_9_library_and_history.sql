-- Phase 9 — library, history, and data rights
--
-- Five things, all decided in docs/product/phase-9-scope.md:
--
-- 1. History covers discography questions, so `input_kind` widens.
-- 2. Favourites gain tags, normalised by trigger because a per-element rule is
--    not expressible as a CHECK constraint.
-- 3. Favourites gain a versioned explanation snapshot, so a kept discovery
--    still explains itself after its originating session is deleted.
-- 4. Keyset indexes, because pagination is cursor-based.
-- 5. `export_user_data`, which makes deletion checkable rather than claimed.
--
-- No table grants to service_role and no private schema usage are added. The
-- one new function follows the claim_ai_usage pattern: security definer, pinned
-- search_path, revoked from PUBLIC, granted to service_role only.

begin;

-- 1. Discography questions become history entries, one per conversation.
alter table public.discovery_sessions
  drop constraint discovery_sessions_input_kind_check;

alter table public.discovery_sessions
  add constraint discovery_sessions_input_kind_check
  check (input_kind in ('artist', 'mood', 'discography'));

-- 2 and 3. Tags and the explanation snapshot.
--
-- The snapshot is deliberately a copy rather than a reference.
-- `discovery_results` cascades from `discovery_sessions`, so pointing at it
-- would mean clearing history silently strips every saved favourite of the
-- explanation that caused it to be saved.
alter table public.favorite_discoveries
  add column tags text[] not null default '{}'
    check (array_length(tags, 1) is null or array_length(tags, 1) <= 20),
  add column explanation jsonb,
  add column explanation_version integer
    check (explanation_version is null or explanation_version > 0),
  add column explanation_source text
    check (explanation_source is null or explanation_source in ('ai', 'template')),
  add column explanation_provider text
    check (
      explanation_provider is null
      or explanation_provider in ('openai', 'anthropic', 'openrouter', 'gemini')
    ),
  add column explanation_model text
    check (explanation_model is null or char_length(explanation_model) <= 255);

-- A snapshot without its version cannot be rendered safely, and a version
-- without a snapshot describes nothing.
alter table public.favorite_discoveries
  add constraint favorite_discoveries_explanation_versioned
  check ((explanation is null) = (explanation_version is null));

-- A template explanation has no provider; an AI one must name it, or "which
-- model said this" is unanswerable for exactly the rows where it matters.
alter table public.favorite_discoveries
  add constraint favorite_discoveries_explanation_attributed
  check (
    explanation_source is distinct from 'ai'
    or explanation_provider is not null
  );

/*
 * Tag normalisation.
 *
 * A trigger rather than a constraint because CHECK cannot contain a subquery,
 * so "every element is 1-40 characters" is not expressible as one. Doing it
 * here rather than in the application means "Trip Hop", "trip hop " and
 * "TRIP HOP" are the same tag in the database, not merely at whichever call
 * site remembered to normalise. A unique index on raw text would not collapse
 * them either.
 */
create or replace function public.normalize_favorite_tags()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tags is null then
    new.tags := '{}';
    return new;
  end if;

  select coalesce(array_agg(distinct cleaned order by cleaned), '{}')
  into new.tags
  from (
    select left(lower(btrim(tag)), 40) as cleaned
    from unnest(new.tags) as tag
  ) as normalized
  where cleaned <> '';

  return new;
end;
$$;

create trigger favorite_discoveries_normalize_tags
  before insert or update of tags on public.favorite_discoveries
  for each row execute function public.normalize_favorite_tags();

-- 4. Keyset pagination indexes, one per sort mode.
--
-- Phase 2 created (user_id, created_at desc) under these names, which cannot
-- serve the keyset predicate `(created_at, id) < (?, ?)` when timestamps tie —
-- and they do tie, because several favourites can be saved in one transaction.
-- Replaced rather than supplemented: the new index has the same leading columns,
-- so keeping both would mean maintaining two indexes for one access path.
drop index if exists public.favorite_discoveries_user_created_idx;
drop index if exists public.discovery_sessions_user_created_idx;

create index favorite_discoveries_user_created_idx
  on public.favorite_discoveries(user_id, created_at desc, id);

create index favorite_discoveries_user_artist_idx
  on public.favorite_discoveries(user_id, artist_name, id);

create index favorite_discoveries_tags_idx
  on public.favorite_discoveries using gin(tags);

create index discovery_sessions_user_created_idx
  on public.discovery_sessions(user_id, created_at desc, id);

/*
 * 5. Enumerate everything one listener owns.
 *
 * Whole rows via `to_jsonb(t.*)` rather than a hand-written column list. That
 * is the load-bearing choice: a column added to any of these tables later is
 * included automatically, so the coverage test cannot pass while the export
 * quietly omits a field. A column list would have to be maintained by whoever
 * remembers, which is the failure this function exists to make impossible.
 *
 * Scope is the `public` schema only. The `private` tables are operational, not
 * user-owned: encrypted credentials, idempotency records, usage events and
 * security audit rows. A listener is entitled to their library and history, not
 * to their own refresh-token ciphertext.
 *
 * Note `profiles` keys on `id`, not `user_id`. Ownership here is "references
 * auth.users", and the coverage test asserts against that rather than against a
 * column name — a rule keyed on `user_id` would have silently excluded this
 * table from the check.
 *
 * Read-only, and reachable only by service_role. It takes a user id, so EXECUTE
 * from a browser-facing role would let a signed-in listener enumerate someone
 * else's account.
 */
create or replace function public.export_user_data(p_user_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select jsonb_build_object(
    -- Keyed on `id`, not `user_id`. See the note above.
    'profiles', (
      select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb)
      from public.profiles as t where t.id = p_user_id
    ),
    'favorite_discoveries', (
      select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb)
      from public.favorite_discoveries as t where t.user_id = p_user_id
    ),
    'dismissed_discoveries', (
      select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb)
      from public.dismissed_discoveries as t where t.user_id = p_user_id
    ),
    'discovery_sessions', (
      select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb)
      from public.discovery_sessions as t where t.user_id = p_user_id
    ),
    'discovery_results', (
      select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb)
      from public.discovery_results as t where t.user_id = p_user_id
    ),
    'generated_playlists', (
      select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb)
      from public.generated_playlists as t where t.user_id = p_user_id
    ),
    'generated_playlist_tracks', (
      select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb)
      from public.generated_playlist_tracks as t where t.user_id = p_user_id
    ),
    'discography_conversations', (
      select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb)
      from public.discography_conversations as t where t.user_id = p_user_id
    ),
    'discography_messages', (
      select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb)
      from public.discography_messages as t where t.user_id = p_user_id
    ),
    -- Whole row like the rest. This table holds no secret: the encrypted
    -- refresh token lives in private.spotify_credentials, which this function
    -- deliberately does not reach.
    'spotify_connections', (
      select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb)
      from public.spotify_connections as t where t.user_id = p_user_id
    )
  );
$$;

do $$
declare
  target text;
begin
  target := 'function public.export_user_data(uuid)';
  execute format('revoke all on %s from public', target);
  execute format('revoke all on %s from anon', target);
  execute format('revoke all on %s from authenticated', target);
  execute format('grant execute on %s to service_role', target);
end;
$$;

commit;
