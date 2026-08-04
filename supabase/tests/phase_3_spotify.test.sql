-- Phase 3 — privilege tests for the Spotify credential RPCs.
--
-- The functions are `security definer` over the private schema, so the only
-- thing standing between a signed-in user and every stored refresh token is
-- the EXECUTE grant. These tests assert that boundary directly.

begin;

create extension if not exists pgtap with schema extensions;

select plan(26);

-- ---------------------------------------------------------------------------
-- The functions exist with the expected shape
-- ---------------------------------------------------------------------------

select has_function('public', 'begin_spotify_oauth', 'begin_spotify_oauth exists');
select has_function('public', 'consume_spotify_oauth', 'consume_spotify_oauth exists');
select has_function('public', 'claim_spotify_connection', 'claim_spotify_connection exists');
select has_function('public', 'store_spotify_credentials', 'store_spotify_credentials exists');
select has_function('public', 'read_spotify_credentials', 'read_spotify_credentials exists');
select has_function('public', 'rotate_spotify_credentials', 'rotate_spotify_credentials exists');
select has_function('public', 'mark_spotify_connection_expired', 'mark_spotify_connection_expired exists');
select has_function('public', 'disconnect_spotify', 'disconnect_spotify exists');
select has_function('public', 'purge_expired_spotify_oauth_transactions', 'purge function exists');

-- ---------------------------------------------------------------------------
-- Every function is security definer with a pinned search_path
-- ---------------------------------------------------------------------------

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'begin_spotify_oauth', 'consume_spotify_oauth', 'claim_spotify_connection',
        'store_spotify_credentials', 'read_spotify_credentials',
        'rotate_spotify_credentials', 'mark_spotify_connection_expired',
        'disconnect_spotify', 'purge_expired_spotify_oauth_transactions'
      )
      and not p.prosecdef
  ),
  0,
  'every Spotify RPC is security definer'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like '%spotify%'
      and not coalesce(p.proconfig::text like '%search_path=%', false)
  ),
  0,
  'every Spotify RPC pins search_path'
);

-- ---------------------------------------------------------------------------
-- EXECUTE is denied to the browser-facing roles and granted to service_role
-- ---------------------------------------------------------------------------

select ok(
  not has_function_privilege('anon', 'public.read_spotify_credentials(uuid)', 'execute'),
  'anon cannot read stored Spotify credentials'
);
select ok(
  not has_function_privilege('authenticated', 'public.read_spotify_credentials(uuid)', 'execute'),
  'authenticated cannot read stored Spotify credentials'
);
select ok(
  not has_function_privilege('anon', 'public.consume_spotify_oauth(bytea)', 'execute'),
  'anon cannot consume an OAuth transaction'
);
select ok(
  not has_function_privilege('authenticated', 'public.consume_spotify_oauth(bytea)', 'execute'),
  'authenticated cannot consume an OAuth transaction'
);
select ok(
  not has_function_privilege('authenticated', 'public.rotate_spotify_credentials(uuid, uuid, timestamptz, bytea, bytea, bytea, bytea, integer, timestamptz)', 'execute'),
  'authenticated cannot rotate credentials'
);
select ok(
  not has_function_privilege('authenticated', 'public.claim_spotify_connection(uuid, uuid, text, text, text[])', 'execute'),
  'authenticated cannot claim a connection directly'
);
select ok(
  not has_function_privilege('authenticated', 'public.store_spotify_credentials(uuid, uuid, bytea, bytea, bytea, bytea, integer, timestamptz)', 'execute'),
  'authenticated cannot store credentials directly'
);
select ok(
  not has_function_privilege('authenticated', 'public.disconnect_spotify(uuid)', 'execute'),
  'authenticated cannot invoke disconnect directly'
);

select ok(
  has_function_privilege('service_role', 'public.read_spotify_credentials(uuid)', 'execute'),
  'service_role can read stored Spotify credentials'
);
select ok(
  has_function_privilege('service_role', 'public.disconnect_spotify(uuid)', 'execute'),
  'service_role can disconnect'
);

-- ---------------------------------------------------------------------------
-- The private schema itself stays unreachable
-- ---------------------------------------------------------------------------

select ok(
  not has_schema_privilege('anon', 'private', 'usage'),
  'anon has no usage on the private schema'
);
select ok(
  not has_schema_privilege('authenticated', 'private', 'usage'),
  'authenticated has no usage on the private schema'
);
select ok(
  not has_table_privilege('authenticated', 'private.spotify_credentials', 'select'),
  'authenticated cannot select credentials'
);
select ok(
  not has_table_privilege('authenticated', 'private.spotify_oauth_transactions', 'select'),
  'authenticated cannot select OAuth transactions'
);

-- ---------------------------------------------------------------------------
-- Connection metadata stays read-only for its owner
-- ---------------------------------------------------------------------------

select ok(
  has_table_privilege('authenticated', 'public.spotify_connections', 'select'),
  'authenticated can read their own connection metadata'
);
select ok(
  not has_table_privilege('authenticated', 'public.spotify_connections', 'insert'),
  'authenticated cannot insert a connection'
);
select ok(
  not has_table_privilege('authenticated', 'public.spotify_connections', 'update'),
  'authenticated cannot alter a connection'
);
select ok(
  not has_table_privilege('authenticated', 'public.spotify_connections', 'delete'),
  'authenticated cannot delete a connection'
);

select * from finish();

rollback;
