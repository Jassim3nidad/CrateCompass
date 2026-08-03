begin;

create extension if not exists pgtap with schema extensions;

select plan(28);

create temporary table tap_output (
  sequence bigint generated always as identity,
  result text not null
) on commit preserve rows;

grant select, insert on pg_temp.tap_output to anon, authenticated;
grant usage, select on sequence pg_temp.tap_output_sequence_seq to anon, authenticated;

insert into pg_temp.tap_output (result) select has_table('public', 'profiles', 'profiles table exists');
insert into pg_temp.tap_output (result) select has_table('public', 'spotify_connections', 'spotify connections table exists');
insert into pg_temp.tap_output (result) select has_table('public', 'favorite_discoveries', 'favorites table exists');
insert into pg_temp.tap_output (result) select has_table('public', 'discovery_sessions', 'discovery sessions table exists');
insert into pg_temp.tap_output (result) select has_table('public', 'discovery_results', 'discovery results table exists');
insert into pg_temp.tap_output (result) select has_table('public', 'generated_playlists', 'generated playlists table exists');
insert into pg_temp.tap_output (result) select has_table('public', 'discography_conversations', 'conversations table exists');
insert into pg_temp.tap_output (result) select has_table('public', 'discography_messages', 'messages table exists');
insert into pg_temp.tap_output (result) select has_table('private', 'spotify_credentials', 'credentials table is private');
insert into pg_temp.tap_output (result) select has_table('private', 'spotify_oauth_transactions', 'OAuth transactions table is private');
insert into pg_temp.tap_output (result) select has_table('private', 'idempotency_records', 'idempotency records table is private');
insert into pg_temp.tap_output (result) select has_table('private', 'security_events', 'security events table is private');

insert into pg_temp.tap_output (result) select ok(
  (
    select bool_and(c.relrowsecurity)
    from pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'profiles',
        'spotify_connections',
        'favorite_discoveries',
        'discovery_sessions',
        'discovery_results',
        'generated_playlists',
        'discography_conversations',
        'discography_messages'
      )
  ),
  'RLS is enabled on every public user-data table'
);

insert into pg_temp.tap_output (result) select ok(
  (
    select bool_and(c.relrowsecurity)
    from pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'private'
      and c.relname in (
        'spotify_credentials',
        'spotify_oauth_transactions',
        'idempotency_records',
        'security_events'
      )
  ),
  'RLS is enabled on every private user-data table'
);

insert into pg_temp.tap_output (result) select ok(
  not has_schema_privilege('authenticated', 'private', 'USAGE'),
  'authenticated clients cannot use the private schema'
);
insert into pg_temp.tap_output (result) select ok(
  not has_table_privilege('authenticated', 'private.spotify_credentials', 'SELECT'),
  'authenticated clients cannot read Spotify credentials'
);
insert into pg_temp.tap_output (result) select ok(
  not has_table_privilege('anon', 'public.favorite_discoveries', 'SELECT'),
  'anonymous clients have no favorites table grant'
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
    '11111111-1111-4111-8111-111111111111',
    'authenticated',
    'authenticated',
    'rls-one@cratecompass.test',
    crypt('not-a-real-password', gen_salt('bf')),
    timezone('utc', now()),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"RLS One"}'::jsonb,
    timezone('utc', now()),
    timezone('utc', now())
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '22222222-2222-4222-8222-222222222222',
    'authenticated',
    'authenticated',
    'rls-two@cratecompass.test',
    crypt('not-a-real-password', gen_salt('bf')),
    timezone('utc', now()),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"RLS Two"}'::jsonb,
    timezone('utc', now()),
    timezone('utc', now())
  );

insert into pg_temp.tap_output (result) select is(
  (select count(*) from public.profiles where id in (
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222'
  )),
  2::bigint,
  'auth user creation creates profiles'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);

insert into pg_temp.tap_output (result) select is(
  (select count(*) from public.profiles),
  1::bigint,
  'a user can read only their own profile'
);

insert into pg_temp.tap_output (result) select lives_ok(
  $$
    insert into public.favorite_discoveries (user_id, artist_name, source_type)
    values ('11111111-1111-4111-8111-111111111111', 'Own Artist', 'manual')
  $$,
  'a user can insert their own favorite'
);

insert into pg_temp.tap_output (result) select throws_ok(
  $$
    insert into public.favorite_discoveries (user_id, artist_name, source_type)
    values ('22222222-2222-4222-8222-222222222222', 'Other Artist', 'manual')
  $$,
  '42501',
  null,
  'cross-user inserts are denied'
);

insert into pg_temp.tap_output (result) select is(
  (select count(*) from public.favorite_discoveries),
  1::bigint,
  'the first user sees only their favorite'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',
  true
);

insert into pg_temp.tap_output (result) select lives_ok(
  $$
    insert into public.favorite_discoveries (user_id, artist_name, source_type)
    values ('22222222-2222-4222-8222-222222222222', 'Second Artist', 'manual')
  $$,
  'a second user can insert their own favorite'
);

insert into pg_temp.tap_output (result) select is(
  (select count(*) from public.favorite_discoveries),
  1::bigint,
  'the second user cannot read the first user favorite'
);

insert into pg_temp.tap_output (result) select throws_ok(
  $$
    update public.favorite_discoveries
    set user_id = '11111111-1111-4111-8111-111111111111'
    where user_id = '22222222-2222-4222-8222-222222222222'
  $$,
  '42501',
  null,
  'ownership cannot be reassigned'
);

reset role;
set local role anon;
insert into pg_temp.tap_output (result) select throws_ok(
  $$ select count(*) from public.favorite_discoveries $$,
  '42501',
  null,
  'anonymous reads are denied'
);

reset role;
delete from auth.users where id = '11111111-1111-4111-8111-111111111111';

insert into pg_temp.tap_output (result) select is(
  (select count(*) from public.favorite_discoveries where user_id = '11111111-1111-4111-8111-111111111111'),
  0::bigint,
  'deleting an auth user cascades to owned data'
);

insert into pg_temp.tap_output (result) select is(
  (select count(*) from public.profiles where id = '11111111-1111-4111-8111-111111111111'),
  0::bigint,
  'deleting an auth user cascades to the profile'
);

delete from auth.users where id = '22222222-2222-4222-8222-222222222222';

insert into pg_temp.tap_output (result)
select * from finish();

commit;

select result from pg_temp.tap_output order by sequence;
