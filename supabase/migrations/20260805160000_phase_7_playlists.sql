-- Phase 7 — mood playlists.
--
-- Three things this adds, all in service of one property: a playlist creation
-- that is interrupted, retried, or double-submitted must never produce two
-- playlists in someone's Spotify account, and a playlist whose items only
-- partially added must be repairable rather than merely reported.
--
-- 1. `generated_playlist_tracks` records what a playlist was meant to contain,
--    per item, with its add status. Without it a partial failure is visible but
--    unfixable, and "created but incomplete" is a state this feature will
--    genuinely produce.
-- 2. `generated_playlists` gains the draft/idempotency fields the creation
--    state machine needs.
-- 3. Two `security definer` RPCs over `private.idempotency_records`. The
--    private schema is not exposed to PostgREST and `service_role` has no USAGE
--    on it, so reviewed functions are the only path — the same shape as the
--    Phase 3 Spotify RPCs and the Phase 5 usage limiter.
--
-- Spotify URIs are stored here under the compliance plan's "only when
-- operationally required" exception: repairing a half-added playlist requires
-- knowing which URIs were intended. Phase 9 retention rules apply to them.

begin;

alter table public.generated_playlists
  add column mood_text text
    check (mood_text is null or char_length(mood_text) <= 2000),
  add column is_public boolean not null default false,
  add column track_total integer not null default 0
    check (track_total >= 0),
  add column tracks_added integer not null default 0
    check (tracks_added >= 0),
  add column idempotency_key text
    check (idempotency_key is null or char_length(idempotency_key) between 8 and 255),
  add column spotify_playlist_url text
    check (spotify_playlist_url is null or char_length(spotify_playlist_url) <= 1000);

-- 'partial' is a first-class outcome, not a variant of failure: the playlist
-- exists in Spotify and some items are in it. Reporting that as failed would be
-- a lie the listener can check.
alter table public.generated_playlists
  drop constraint generated_playlists_status_check;

alter table public.generated_playlists
  add constraint generated_playlists_status_check
  check (status in ('draft', 'creating', 'created', 'partial', 'failed'));

alter table public.generated_playlists
  add constraint generated_playlists_added_within_total
  check (tracks_added <= track_total);

-- One in-flight creation per key per user. This is the duplicate-submission
-- control: a retried server action reuses the row rather than creating one.
create unique index generated_playlists_idempotency_idx
  on public.generated_playlists(user_id, idempotency_key)
  where idempotency_key is not null;

-- Phase 2 gave the other parent tables a composite key so children could carry
-- an owner-scoped foreign key; `generated_playlists` was missed because nothing
-- referenced it yet. A child row must not be able to name a playlist belonging
-- to a different user, which a plain `references(id)` would permit.
alter table public.generated_playlists
  add constraint generated_playlists_id_user_key unique (id, user_id);

create table public.generated_playlist_tracks (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  position integer not null check (position > 0),
  -- MusicBrainz identity is what the track *is*; the Spotify URI is only how
  -- this deployment reaches it. Keeping both makes a re-resolution possible if
  -- a URI stops working.
  recording_mbid text not null check (char_length(recording_mbid) between 1 and 255),
  artist_mbid text not null check (char_length(artist_mbid) between 1 and 255),
  track_title text not null check (char_length(track_title) between 1 and 500),
  artist_name text not null check (char_length(artist_name) between 1 and 255),
  release_title text check (release_title is null or char_length(release_title) <= 500),
  spotify_uri text check (spotify_uri is null or char_length(spotify_uri) <= 255),
  status text not null default 'pending'
    check (status in ('pending', 'added', 'unresolved', 'failed')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  foreign key (playlist_id, user_id)
    references public.generated_playlists(id, user_id) on delete cascade,
  unique (playlist_id, position),
  -- A track cannot be reported as added without the URI that was added.
  check (status <> 'added' or spotify_uri is not null)
);

-- Every read is "the tracks of this playlist, in order", for this owner.
create index generated_playlist_tracks_user_playlist_idx
  on public.generated_playlist_tracks(user_id, playlist_id, position);

create trigger generated_playlist_tracks_set_updated_at
before update on public.generated_playlist_tracks
for each row execute function public.set_updated_at();

create trigger generated_playlist_tracks_owner_immutable
before update on public.generated_playlist_tracks
for each row execute function private.prevent_owner_change();

alter table public.generated_playlist_tracks enable row level security;

grant select, insert, update, delete
  on public.generated_playlist_tracks to authenticated;

create policy generated_playlist_tracks_select_own on public.generated_playlist_tracks
for select to authenticated using ((select auth.uid()) = user_id);
create policy generated_playlist_tracks_insert_own on public.generated_playlist_tracks
for insert to authenticated with check ((select auth.uid()) = user_id);
create policy generated_playlist_tracks_update_own on public.generated_playlist_tracks
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy generated_playlist_tracks_delete_own on public.generated_playlist_tracks
for delete to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Idempotency RPCs over the private schema
-- ---------------------------------------------------------------------------

/*
 * Claims an operation key, or reports that it is already claimed.
 *
 * Returns the stored response when the same user replays the same key with the
 * same request, which is what makes a retried playlist creation return the
 * original playlist instead of making a second one. A *different* request under
 * the same key is a conflict and says so rather than silently reusing.
 */
create or replace function public.claim_idempotency_key(
  p_user_id uuid,
  p_operation text,
  p_idempotency_key text,
  p_request_digest bytea,
  p_ttl_seconds integer default 86400
)
returns table (claimed boolean, conflict boolean, response_body jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing private.idempotency_records%rowtype;
begin
  delete from private.idempotency_records
  where expires_at < timezone('utc', now());

  select * into existing
  from private.idempotency_records as records
  where records.user_id = p_user_id
    and records.operation = p_operation
    and records.idempotency_key = p_idempotency_key;

  if found then
    return query
      select
        false,
        existing.request_digest is distinct from p_request_digest,
        existing.response_body;
    return;
  end if;

  insert into private.idempotency_records (
    user_id, operation, idempotency_key, request_digest, expires_at
  )
  values (
    p_user_id,
    p_operation,
    p_idempotency_key,
    p_request_digest,
    timezone('utc', now()) + make_interval(secs => p_ttl_seconds)
  );

  return query select true, false, null::jsonb;
end;
$$;

/* Records the outcome so a later replay returns it instead of re-running. */
create or replace function public.complete_idempotency_key(
  p_user_id uuid,
  p_operation text,
  p_idempotency_key text,
  p_response_status integer,
  p_response_body jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.idempotency_records
  set response_status = p_response_status,
      response_body = p_response_body
  where user_id = p_user_id
    and operation = p_operation
    and idempotency_key = p_idempotency_key;
end;
$$;

/*
 * Releases a claim so a failed attempt can be retried.
 *
 * Without this, a creation that fails before reaching Spotify would hold its
 * key for the full TTL and the listener would be told they had already created
 * a playlist that does not exist.
 */
create or replace function public.release_idempotency_key(
  p_user_id uuid,
  p_operation text,
  p_idempotency_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private.idempotency_records
  where user_id = p_user_id
    and operation = p_operation
    and idempotency_key = p_idempotency_key
    and response_status is null;
end;
$$;

-- CREATE FUNCTION grants EXECUTE to PUBLIC by default. These are security
-- definer over the private schema, so that default must be revoked before
-- service_role is granted access — otherwise any signed-in user could read
-- another user's stored idempotency responses.
do $$
declare
  target text;
begin
  foreach target in array array[
    'public.claim_idempotency_key(uuid,text,text,bytea,integer)',
    'public.complete_idempotency_key(uuid,text,text,integer,jsonb)',
    'public.release_idempotency_key(uuid,text,text)'
  ]
  loop
    execute format('revoke all on function %s from public', target);
    execute format('revoke all on function %s from anon', target);
    execute format('revoke all on function %s from authenticated', target);
    execute format('grant execute on function %s to service_role', target);
  end loop;
end;
$$;

commit;
