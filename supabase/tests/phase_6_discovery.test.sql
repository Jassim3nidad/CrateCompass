-- Phase 6 — dismissals and idempotent favourites.
--
-- Two properties are asserted here that the application cannot guarantee on
-- its own: that one listener's dismissals are invisible to another, and that
-- saving the same artist twice is a no-op at the storage layer rather than a
-- race the UI happens to avoid.

begin;

create extension if not exists pgtap with schema extensions;

select plan(20);

create temporary table tap_output (
  sequence bigint generated always as identity,
  result text not null
) on commit preserve rows;

grant select, insert on pg_temp.tap_output to anon, authenticated;
grant usage, select on sequence pg_temp.tap_output_sequence_seq to anon, authenticated;

insert into pg_temp.tap_output (result) select has_table(
  'public', 'dismissed_discoveries', 'dismissed discoveries table exists'
);

insert into pg_temp.tap_output (result) select ok(
  (
    select c.relrowsecurity
    from pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'dismissed_discoveries'
  ),
  'RLS is enabled on dismissed discoveries'
);

insert into pg_temp.tap_output (result) select ok(
  not has_table_privilege('anon', 'public.dismissed_discoveries', 'SELECT'),
  'anonymous clients have no dismissals grant'
);

-- Dismissals have no mutable column, so no UPDATE grant should exist. An
-- update path would need an ownership-immutability trigger to be safe.
insert into pg_temp.tap_output (result) select ok(
  not has_table_privilege('authenticated', 'public.dismissed_discoveries', 'UPDATE'),
  'dismissals cannot be updated, only created and removed'
);

insert into pg_temp.tap_output (result) select has_index(
  'public',
  'dismissed_discoveries',
  'dismissed_discoveries_user_seed_idx',
  'dismissals are indexed by owner and seed artist'
);

insert into pg_temp.tap_output (result) select has_index(
  'public',
  'favorite_discoveries',
  'favorite_discoveries_unique_artist_idx',
  'artist favourites carry a uniqueness index'
);

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '31111111-1111-4111-8111-111111111111',
    'authenticated',
    'authenticated',
    'discovery-one@cratecompass.test',
    crypt('not-a-real-password', gen_salt('bf')),
    timezone('utc', now()),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Discovery One"}'::jsonb,
    timezone('utc', now()),
    timezone('utc', now())
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '32222222-2222-4222-8222-222222222222',
    'authenticated',
    'authenticated',
    'discovery-two@cratecompass.test',
    crypt('not-a-real-password', gen_salt('bf')),
    timezone('utc', now()),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Discovery Two"}'::jsonb,
    timezone('utc', now()),
    timezone('utc', now())
  );

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"31111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);

insert into pg_temp.tap_output (result) select lives_ok(
  $$
    insert into public.dismissed_discoveries
      (user_id, seed_artist_mbid, candidate_artist_mbid, candidate_name)
    values (
      '31111111-1111-4111-8111-111111111111',
      'f1000000-0000-4000-8000-000000000001',
      'f2000000-0000-4000-8000-000000000001',
      'Vellum Coast'
    )
  $$,
  'a listener can dismiss a candidate'
);

insert into pg_temp.tap_output (result) select throws_ok(
  $$
    insert into public.dismissed_discoveries
      (user_id, seed_artist_mbid, candidate_artist_mbid, candidate_name)
    values (
      '31111111-1111-4111-8111-111111111111',
      'f1000000-0000-4000-8000-000000000001',
      'f2000000-0000-4000-8000-000000000001',
      'Vellum Coast'
    )
  $$,
  '23505',
  null,
  'dismissing the same candidate twice is refused, not duplicated'
);

-- Dismissal is scoped to a seed: the same artist may still be a wanted
-- suggestion under a different one.
insert into pg_temp.tap_output (result) select lives_ok(
  $$
    insert into public.dismissed_discoveries
      (user_id, seed_artist_mbid, candidate_artist_mbid, candidate_name)
    values (
      '31111111-1111-4111-8111-111111111111',
      'f1000000-0000-4000-8000-000000000009',
      'f2000000-0000-4000-8000-000000000001',
      'Vellum Coast'
    )
  $$,
  'the same candidate can be dismissed separately per seed artist'
);

insert into pg_temp.tap_output (result) select throws_ok(
  $$
    insert into public.dismissed_discoveries
      (user_id, seed_artist_mbid, candidate_artist_mbid, candidate_name)
    values (
      '32222222-2222-4222-8222-222222222222',
      'f1000000-0000-4000-8000-000000000001',
      'f2000000-0000-4000-8000-000000000002',
      'Ash Meridian'
    )
  $$,
  '42501',
  null,
  'a listener cannot dismiss on another listener''s behalf'
);

insert into pg_temp.tap_output (result) select lives_ok(
  $$
    insert into public.favorite_discoveries
      (user_id, artist_name, canonical_artist_id, source_type)
    values (
      '31111111-1111-4111-8111-111111111111',
      'Vellum Coast',
      'f2000000-0000-4000-8000-000000000001',
      'artist'
    )
  $$,
  'a listener can save a discovered artist'
);

insert into pg_temp.tap_output (result) select throws_ok(
  $$
    insert into public.favorite_discoveries
      (user_id, artist_name, canonical_artist_id, source_type)
    values (
      '31111111-1111-4111-8111-111111111111',
      'Vellum Coast',
      'f2000000-0000-4000-8000-000000000001',
      'artist'
    )
  $$,
  '23505',
  null,
  'saving the same artist twice is refused rather than duplicated'
);

-- The index is scoped so a future album favourite for the same artist is not
-- blocked by the artist-level uniqueness rule.
insert into pg_temp.tap_output (result) select lives_ok(
  $$
    insert into public.favorite_discoveries
      (user_id, artist_name, canonical_artist_id, canonical_recording_id, source_type)
    values (
      '31111111-1111-4111-8111-111111111111',
      'Vellum Coast',
      'f2000000-0000-4000-8000-000000000001',
      'f4000000-0000-4000-8000-000000000001',
      'artist'
    )
  $$,
  'a recording-level favourite for the same artist is still allowed'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"32222222-2222-4222-8222-222222222222","role":"authenticated"}',
  true
);

insert into pg_temp.tap_output (result) select is(
  (select count(*) from public.dismissed_discoveries),
  0::bigint,
  'a listener cannot see another listener''s dismissals'
);

insert into pg_temp.tap_output (result) select lives_ok(
  $$
    insert into public.dismissed_discoveries
      (user_id, seed_artist_mbid, candidate_artist_mbid, candidate_name)
    values (
      '32222222-2222-4222-8222-222222222222',
      'f1000000-0000-4000-8000-000000000001',
      'f2000000-0000-4000-8000-000000000001',
      'Vellum Coast'
    )
  $$,
  'two listeners may dismiss the same candidate independently'
);

insert into pg_temp.tap_output (result) select is(
  (select count(*) from public.dismissed_discoveries),
  1::bigint,
  'each listener sees only their own dismissal'
);

insert into pg_temp.tap_output (result) select is(
  (
    select count(*) from public.dismissed_discoveries
    where user_id = '31111111-1111-4111-8111-111111111111'
  ),
  0::bigint,
  'filtering by another owner still returns nothing'
);

-- Undo is a delete, and it must only reach the caller's own row. The delete
-- itself is permitted to run — RLS filters the rows it can see rather than
-- raising — so the real assertion is the one after it: the target survived.
insert into pg_temp.tap_output (result) select lives_ok(
  $$
    delete from public.dismissed_discoveries
    where user_id = '31111111-1111-4111-8111-111111111111'
  $$,
  'a delete aimed at another listener''s dismissal runs without error'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"31111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);

insert into pg_temp.tap_output (result) select is(
  (select count(*) from public.dismissed_discoveries),
  2::bigint,
  'both of the first listener''s dismissals survived the attempted delete'
);

reset role;
set local role anon;

insert into pg_temp.tap_output (result) select throws_ok(
  $$ select count(*) from public.dismissed_discoveries $$,
  '42501',
  null,
  'anonymous clients cannot read dismissals'
);

reset role;

-- Cascades clean up the dismissals and favourites created above.
delete from auth.users where id in (
  '31111111-1111-4111-8111-111111111111',
  '32222222-2222-4222-8222-222222222222'
);

insert into pg_temp.tap_output (result)
select * from finish();

commit;

select result from pg_temp.tap_output order by sequence;
