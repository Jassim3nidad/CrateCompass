-- Phase 6 — similar-artist discovery.
--
-- Two changes, both about the same thing: a discovery decision the user has
-- already made must survive a reload.
--
-- 1. `dismissed_discoveries` records "not this one", so a dismissed candidate
--    does not reappear at the top of the next result set. Without it, dismiss
--    is a purely visual action that the next page load undoes.
-- 2. A partial unique index makes saving an artist idempotent. A double-submit
--    or a retried server action would otherwise create a second identical
--    favourite, which the library in Phase 9 would then show twice.
--
-- No Spotify identifiers are stored by either. Discovery is an application and
-- MusicBrainz/ListenBrainz concern; Spotify resolution happens per request and
-- is not persisted.

begin;

create table public.dismissed_discoveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- MusicBrainz identifiers, held as text for the same reason the Phase 2
  -- tables do: they are external references, not local foreign keys.
  seed_artist_mbid text not null
    check (char_length(seed_artist_mbid) between 1 and 255),
  candidate_artist_mbid text not null
    check (char_length(candidate_artist_mbid) between 1 and 255),
  candidate_name text not null
    check (char_length(candidate_name) between 1 and 255),
  created_at timestamptz not null default timezone('utc', now()),
  -- Dismissal is per seed: not wanting an artist as a match for one seed says
  -- nothing about whether they belong under another.
  unique (user_id, seed_artist_mbid, candidate_artist_mbid)
);

create index dismissed_discoveries_user_seed_idx
  on public.dismissed_discoveries(user_id, seed_artist_mbid);

-- Scoped to artist-only favourites so a future album or recording favourite
-- for the same artist is not blocked by this constraint.
create unique index favorite_discoveries_unique_artist_idx
  on public.favorite_discoveries(user_id, source_type, canonical_artist_id)
  where canonical_artist_id is not null and canonical_recording_id is null;

alter table public.dismissed_discoveries enable row level security;

-- No update grant, and therefore no owner-immutability trigger: a dismissal
-- has no mutable field. Undo is a delete followed by a fresh insert.
grant select, insert, delete on public.dismissed_discoveries to authenticated;

create policy dismissed_discoveries_select_own on public.dismissed_discoveries
for select to authenticated using ((select auth.uid()) = user_id);
create policy dismissed_discoveries_insert_own on public.dismissed_discoveries
for insert to authenticated with check ((select auth.uid()) = user_id);
create policy dismissed_discoveries_delete_own on public.dismissed_discoveries
for delete to authenticated using ((select auth.uid()) = user_id);

commit;
