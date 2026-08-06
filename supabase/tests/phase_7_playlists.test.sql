-- Phase 7 — playlist records and the idempotency claim.
--
-- The properties asserted here are the ones the application cannot guarantee
-- alone: that a listener cannot see or alter another's playlist tracks, that a
-- track cannot be recorded as added without the URI that was added, and that
-- the idempotency RPCs are reachable only by service_role.

begin;

create extension if not exists pgtap with schema extensions;

select plan(24);

create temporary table tap_output (
  sequence bigint generated always as identity,
  result text not null
) on commit preserve rows;

grant select, insert on pg_temp.tap_output to anon, authenticated;
grant usage, select on sequence pg_temp.tap_output_sequence_seq to anon, authenticated;

insert into pg_temp.tap_output (result) select has_table(
  'public', 'generated_playlist_tracks', 'playlist tracks table exists'
);

insert into pg_temp.tap_output (result) select ok(
  (
    select c.relrowsecurity
    from pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'generated_playlist_tracks'
  ),
  'RLS is enabled on playlist tracks'
);

insert into pg_temp.tap_output (result) select ok(
  not has_table_privilege('anon', 'public.generated_playlist_tracks', 'SELECT'),
  'anonymous clients have no playlist-tracks grant'
);

-- The idempotency functions read another user's stored responses by design, so
-- EXECUTE must not reach the browser-facing roles.
insert into pg_temp.tap_output (result) select ok(
  not has_function_privilege(
    'authenticated',
    'public.claim_idempotency_key(uuid,text,text,bytea,integer)',
    'execute'
  ),
  'authenticated cannot claim idempotency keys directly'
);
insert into pg_temp.tap_output (result) select ok(
  not has_function_privilege(
    'anon',
    'public.claim_idempotency_key(uuid,text,text,bytea,integer)',
    'execute'
  ),
  'anon cannot claim idempotency keys'
);
insert into pg_temp.tap_output (result) select ok(
  has_function_privilege(
    'service_role',
    'public.claim_idempotency_key(uuid,text,text,bytea,integer)',
    'execute'
  ),
  'service_role can claim idempotency keys'
);

insert into pg_temp.tap_output (result) select is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like '%idempotency%'
      and not coalesce(p.proconfig::text like '%search_path=%', false)
  ),
  0,
  'every idempotency RPC pins search_path'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '71111111-1111-4111-8111-111111111111',
    'authenticated', 'authenticated', 'playlist-one@cratecompass.test',
    crypt('not-a-real-password', gen_salt('bf')), timezone('utc', now()),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Playlist One"}'::jsonb,
    timezone('utc', now()), timezone('utc', now())
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '72222222-2222-4222-8222-222222222222',
    'authenticated', 'authenticated', 'playlist-two@cratecompass.test',
    crypt('not-a-real-password', gen_salt('bf')), timezone('utc', now()),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Playlist Two"}'::jsonb,
    timezone('utc', now()), timezone('utc', now())
  );

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"71111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);

insert into pg_temp.tap_output (result) select lives_ok(
  $$
    insert into public.generated_playlists (id, user_id, name, status, track_total)
    values (
      '7a000000-0000-4000-8000-000000000001',
      '71111111-1111-4111-8111-111111111111',
      'Rainy commute',
      'draft',
      2
    )
  $$,
  'a listener can create a draft playlist'
);

insert into pg_temp.tap_output (result) select lives_ok(
  $$
    insert into public.generated_playlist_tracks
      (playlist_id, user_id, position, recording_mbid, artist_mbid, track_title, artist_name)
    values (
      '7a000000-0000-4000-8000-000000000001',
      '71111111-1111-4111-8111-111111111111',
      1, 'rec-1', 'artist-1', 'Safe From Harm', 'Massive Attack'
    )
  $$,
  'a listener can add a track to their own draft'
);

insert into pg_temp.tap_output (result) select throws_ok(
  $$
    insert into public.generated_playlist_tracks
      (playlist_id, user_id, position, recording_mbid, artist_mbid, track_title, artist_name)
    values (
      '7a000000-0000-4000-8000-000000000001',
      '71111111-1111-4111-8111-111111111111',
      1, 'rec-2', 'artist-2', 'Another', 'Someone'
    )
  $$,
  '23505',
  null,
  'two tracks cannot occupy the same position'
);

-- A track reported as added without a URI would make a partial failure
-- unrepairable, because nothing records what was supposed to be there.
insert into pg_temp.tap_output (result) select throws_ok(
  $$
    update public.generated_playlist_tracks
    set status = 'added'
    where recording_mbid = 'rec-1'
  $$,
  '23514',
  null,
  'a track cannot be marked added without a Spotify URI'
);

insert into pg_temp.tap_output (result) select lives_ok(
  $$
    update public.generated_playlist_tracks
    set status = 'added', spotify_uri = 'spotify:track:1'
    where recording_mbid = 'rec-1'
  $$,
  'a track can be marked added together with its URI'
);

insert into pg_temp.tap_output (result) select throws_ok(
  $$
    update public.generated_playlists
    set tracks_added = 99
    where id = '7a000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  null,
  'more tracks cannot be added than the playlist contains'
);

insert into pg_temp.tap_output (result) select lives_ok(
  $$
    update public.generated_playlists
    set status = 'partial', tracks_added = 1
    where id = '7a000000-0000-4000-8000-000000000001'
  $$,
  'partial is an accepted playlist status'
);

-- Ownership cannot be reassigned by editing the row.
insert into pg_temp.tap_output (result) select throws_ok(
  $$
    update public.generated_playlist_tracks
    set user_id = '72222222-2222-4222-8222-222222222222'
    where recording_mbid = 'rec-1'
  $$,
  '42501',
  null,
  'a track cannot be handed to another listener'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"72222222-2222-4222-8222-222222222222","role":"authenticated"}',
  true
);

insert into pg_temp.tap_output (result) select is(
  (select count(*) from public.generated_playlist_tracks),
  0::bigint,
  'a listener cannot see another listener''s playlist tracks'
);

insert into pg_temp.tap_output (result) select throws_ok(
  $$
    insert into public.generated_playlist_tracks
      (playlist_id, user_id, position, recording_mbid, artist_mbid, track_title, artist_name)
    values (
      '7a000000-0000-4000-8000-000000000001',
      '72222222-2222-4222-8222-222222222222',
      2, 'rec-3', 'artist-3', 'Intruder', 'Someone Else'
    )
  $$,
  '23503',
  null,
  'a track cannot be attached to another listener''s playlist'
);

insert into pg_temp.tap_output (result) select lives_ok(
  $$
    delete from public.generated_playlist_tracks
    where user_id = '71111111-1111-4111-8111-111111111111'
  $$,
  'a delete aimed at another listener''s track runs without error'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"71111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);

insert into pg_temp.tap_output (result) select is(
  (select count(*) from public.generated_playlist_tracks),
  1::bigint,
  'the owner''s track survived the attempted delete'
);

reset role;

-- ---------------------------------------------------------------------------
-- Idempotency behaviour, exercised as service_role
-- ---------------------------------------------------------------------------

insert into pg_temp.tap_output (result) select is(
  (
    select claimed
    from public.claim_idempotency_key(
      '71111111-1111-4111-8111-111111111111',
      'create-playlist',
      'key-abcdefgh',
      '\x0102'::bytea,
      3600
    )
  ),
  true,
  'a fresh key is claimed'
);

insert into pg_temp.tap_output (result) select is(
  (
    select claimed
    from public.claim_idempotency_key(
      '71111111-1111-4111-8111-111111111111',
      'create-playlist',
      'key-abcdefgh',
      '\x0102'::bytea,
      3600
    )
  ),
  false,
  'the same key is not claimed twice'
);

-- A different request under the same key is a conflict, not a silent reuse:
-- returning the first playlist for a different set of tracks would be wrong.
insert into pg_temp.tap_output (result) select is(
  (
    select conflict
    from public.claim_idempotency_key(
      '71111111-1111-4111-8111-111111111111',
      'create-playlist',
      'key-abcdefgh',
      '\x9999'::bytea,
      3600
    )
  ),
  true,
  'a different request under the same key is a conflict'
);

select public.complete_idempotency_key(
  '71111111-1111-4111-8111-111111111111',
  'create-playlist',
  'key-abcdefgh',
  200,
  '{"status":"created"}'::jsonb
);

insert into pg_temp.tap_output (result) select is(
  (
    select response_body
    from public.claim_idempotency_key(
      '71111111-1111-4111-8111-111111111111',
      'create-playlist',
      'key-abcdefgh',
      '\x0102'::bytea,
      3600
    )
  ),
  '{"status":"created"}'::jsonb,
  'a replay returns the recorded response instead of re-running'
);

-- Release only applies to an attempt that never completed, so a completed key
-- must survive it and keep replaying.
select public.release_idempotency_key(
  '71111111-1111-4111-8111-111111111111',
  'create-playlist',
  'key-abcdefgh'
);

insert into pg_temp.tap_output (result) select is(
  (
    select response_body
    from public.claim_idempotency_key(
      '71111111-1111-4111-8111-111111111111',
      'create-playlist',
      'key-abcdefgh',
      '\x0102'::bytea,
      3600
    )
  ),
  '{"status":"created"}'::jsonb,
  'releasing a completed key does not discard its response'
);

delete from auth.users where id in (
  '71111111-1111-4111-8111-111111111111',
  '72222222-2222-4222-8222-222222222222'
);

insert into pg_temp.tap_output (result)
select * from finish();

commit;

select result from pg_temp.tap_output order by sequence;
