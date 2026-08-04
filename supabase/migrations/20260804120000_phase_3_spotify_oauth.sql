-- Phase 3 — Spotify connected account.
--
-- Phase 2 already created every table this phase needs. What is missing is a
-- way to reach the ones in `private`: that schema is deliberately absent from
-- PostgREST's exposed schemas, so supabase-js cannot read or write it at all.
--
-- Rather than expose `private` and widen the browser-facing API surface, this
-- migration adds `security definer` functions in `public` whose EXECUTE
-- privilege is revoked from public/anon/authenticated and granted only to
-- `service_role`. The credential tables stay unreachable from the browser
-- while trusted server code can still operate on them, and the generated
-- TypeScript types pick the functions up as typed RPCs.

begin;

-- ---------------------------------------------------------------------------
-- OAuth transactions
-- ---------------------------------------------------------------------------

create or replace function public.begin_spotify_oauth(
  p_transaction_id uuid,
  p_user_id uuid,
  p_state_digest bytea,
  p_code_verifier_ciphertext bytea,
  p_code_verifier_nonce bytea,
  p_encryption_key_version integer,
  p_redirect_path text,
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only one authorization attempt may be outstanding per user. Abandoning a
  -- half-finished attempt must not leave a replayable transaction behind.
  delete from private.spotify_oauth_transactions
  where user_id = p_user_id and consumed_at is null;

  insert into private.spotify_oauth_transactions (
    id, user_id, state_digest, code_verifier_ciphertext, code_verifier_nonce,
    encryption_key_version, redirect_path, expires_at
  )
  values (
    p_transaction_id, p_user_id, p_state_digest, p_code_verifier_ciphertext,
    p_code_verifier_nonce, p_encryption_key_version, p_redirect_path, p_expires_at
  );
end;
$$;

create or replace function public.consume_spotify_oauth(p_state_digest bytea)
returns table (
  transaction_id uuid,
  user_id uuid,
  code_verifier_ciphertext bytea,
  code_verifier_nonce bytea,
  encryption_key_version integer,
  redirect_path text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Single-statement claim: the `consumed_at is null` predicate and the write
  -- happen atomically, so two concurrent callbacks carrying the same state can
  -- never both succeed. A replayed or expired state simply returns no rows.
  --
  -- The returned columns are aliased because this function's OUT parameters
  -- share names with the table's columns, which plpgsql would otherwise report
  -- as ambiguous references.
  return query
  with claimed as (
    update private.spotify_oauth_transactions as transactions
    set consumed_at = timezone('utc', now())
    where transactions.state_digest = p_state_digest
      and transactions.consumed_at is null
      and transactions.expires_at > timezone('utc', now())
    returning
      transactions.id as claimed_transaction_id,
      transactions.user_id as claimed_user_id,
      transactions.code_verifier_ciphertext as claimed_ciphertext,
      transactions.code_verifier_nonce as claimed_nonce,
      transactions.encryption_key_version as claimed_key_version,
      transactions.redirect_path as claimed_redirect_path
  )
  select
    claimed.claimed_transaction_id,
    claimed.claimed_user_id,
    claimed.claimed_ciphertext,
    claimed.claimed_nonce,
    claimed.claimed_key_version,
    claimed.claimed_redirect_path
  from claimed;
end;
$$;

create or replace function public.purge_expired_spotify_oauth_transactions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  purged integer;
begin
  delete from private.spotify_oauth_transactions
  where expires_at < timezone('utc', now()) - interval '1 day';

  get diagnostics purged = row_count;
  return purged;
end;
$$;

-- ---------------------------------------------------------------------------
-- Connection and credentials
-- ---------------------------------------------------------------------------

-- Returns the connection id so the caller can bind credential ciphertext to it
-- through AES-GCM additional authenticated data (ADR 0001). Encryption
-- therefore happens between this call and `store_spotify_credentials`. If the
-- second call never lands, the connection exists without a credential row,
-- which `read_spotify_credentials` reports as no credentials and the UI
-- presents as reconnect-required. That is the correct state: without stored
-- credentials the connection genuinely cannot be used.
create or replace function public.claim_spotify_connection(
  p_connection_id uuid,
  p_user_id uuid,
  p_spotify_user_id text,
  p_display_name text,
  p_scopes text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_id uuid;
begin
  if exists (
    select 1
    from public.spotify_connections as connections
    where connections.spotify_user_id = p_spotify_user_id
      and connections.user_id <> p_user_id
  ) then
    raise exception 'This Spotify account is already linked to another CrateCompass account.'
      using errcode = 'CC001';
  end if;

  insert into public.spotify_connections (
    id, user_id, spotify_user_id, display_name, scopes, status,
    last_verified_at, disconnected_at
  )
  values (
    p_connection_id, p_user_id, p_spotify_user_id, p_display_name, p_scopes,
    'active', timezone('utc', now()), null
  )
  on conflict (user_id) do update
  set spotify_user_id = excluded.spotify_user_id,
      display_name = excluded.display_name,
      scopes = excluded.scopes,
      status = 'active',
      last_verified_at = timezone('utc', now()),
      disconnected_at = null
  returning spotify_connections.id into resolved_id;

  return resolved_id;
end;
$$;

create or replace function public.store_spotify_credentials(
  p_connection_id uuid,
  p_user_id uuid,
  p_access_token_ciphertext bytea,
  p_access_token_nonce bytea,
  p_refresh_token_ciphertext bytea,
  p_refresh_token_nonce bytea,
  p_encryption_key_version integer,
  p_token_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.spotify_connections as connections
    where connections.id = p_connection_id
      and connections.user_id = p_user_id
  ) then
    raise exception 'No Spotify connection exists for this user.'
      using errcode = 'CC002';
  end if;

  insert into private.spotify_credentials (
    connection_id, access_token_ciphertext, access_token_nonce,
    refresh_token_ciphertext, refresh_token_nonce, encryption_key_version,
    token_expires_at
  )
  values (
    p_connection_id, p_access_token_ciphertext, p_access_token_nonce,
    p_refresh_token_ciphertext, p_refresh_token_nonce, p_encryption_key_version,
    p_token_expires_at
  )
  on conflict (connection_id) do update
  set access_token_ciphertext = excluded.access_token_ciphertext,
      access_token_nonce = excluded.access_token_nonce,
      refresh_token_ciphertext = excluded.refresh_token_ciphertext,
      refresh_token_nonce = excluded.refresh_token_nonce,
      encryption_key_version = excluded.encryption_key_version,
      token_expires_at = excluded.token_expires_at;
end;
$$;

create or replace function public.read_spotify_credentials(p_user_id uuid)
returns table (
  connection_id uuid,
  spotify_user_id text,
  status text,
  scopes text[],
  access_token_ciphertext bytea,
  access_token_nonce bytea,
  refresh_token_ciphertext bytea,
  refresh_token_nonce bytea,
  encryption_key_version integer,
  token_expires_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select
    connections.id,
    connections.spotify_user_id,
    connections.status,
    connections.scopes,
    credentials.access_token_ciphertext,
    credentials.access_token_nonce,
    credentials.refresh_token_ciphertext,
    credentials.refresh_token_nonce,
    credentials.encryption_key_version,
    credentials.token_expires_at
  from public.spotify_connections as connections
  join private.spotify_credentials as credentials
    on credentials.connection_id = connections.id
  where connections.user_id = p_user_id
    and connections.status <> 'revoked';
$$;

-- Compare-and-set on the expiry the caller read. Two server instances that
-- refresh the same connection concurrently will both receive a valid token
-- from Spotify, but only the first write lands; the loser re-reads rather than
-- overwriting a newer refresh token with an older one.
create or replace function public.rotate_spotify_credentials(
  p_connection_id uuid,
  p_user_id uuid,
  p_expected_token_expires_at timestamptz,
  p_access_token_ciphertext bytea,
  p_access_token_nonce bytea,
  p_refresh_token_ciphertext bytea,
  p_refresh_token_nonce bytea,
  p_encryption_key_version integer,
  p_token_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated integer;
begin
  update private.spotify_credentials as credentials
  set access_token_ciphertext = p_access_token_ciphertext,
      access_token_nonce = p_access_token_nonce,
      refresh_token_ciphertext = p_refresh_token_ciphertext,
      refresh_token_nonce = p_refresh_token_nonce,
      encryption_key_version = p_encryption_key_version,
      token_expires_at = p_token_expires_at
  from public.spotify_connections as connections
  where credentials.connection_id = p_connection_id
    and connections.id = credentials.connection_id
    and connections.user_id = p_user_id
    and connections.status <> 'revoked'
    and credentials.token_expires_at = p_expected_token_expires_at;

  get diagnostics updated = row_count;

  if updated > 0 then
    update public.spotify_connections
    set status = 'active', last_verified_at = timezone('utc', now())
    where id = p_connection_id and user_id = p_user_id;
  end if;

  return updated > 0;
end;
$$;

create or replace function public.mark_spotify_connection_expired(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.spotify_connections
  set status = 'expired'
  where user_id = p_user_id and status = 'active';
$$;

-- Ciphertext is destroyed before the connection is marked revoked, so a
-- refresh racing a disconnect finds no credential row rather than a row it is
-- still allowed to use.
create or replace function public.disconnect_spotify(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  disconnected integer;
begin
  delete from private.spotify_credentials as credentials
  using public.spotify_connections as connections
  where credentials.connection_id = connections.id
    and connections.user_id = p_user_id;

  delete from private.spotify_oauth_transactions
  where user_id = p_user_id;

  update public.spotify_connections
  set status = 'revoked', disconnected_at = timezone('utc', now())
  where user_id = p_user_id and status <> 'revoked';

  get diagnostics disconnected = row_count;
  return disconnected > 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
--
-- CREATE FUNCTION grants EXECUTE to PUBLIC by default. Every function above is
-- security definer over the private schema, so that default must be revoked
-- before service_role is granted access. Without these revokes any signed-in
-- user could call them over PostgREST RPC.
-- ---------------------------------------------------------------------------

do $$
declare
  target text;
  signature text;
begin
  foreach signature in array array[
    'public.begin_spotify_oauth(uuid, uuid, bytea, bytea, bytea, integer, text, timestamptz)',
    'public.consume_spotify_oauth(bytea)',
    'public.purge_expired_spotify_oauth_transactions()',
    'public.claim_spotify_connection(uuid, uuid, text, text, text[])',
    'public.store_spotify_credentials(uuid, uuid, bytea, bytea, bytea, bytea, integer, timestamptz)',
    'public.read_spotify_credentials(uuid)',
    'public.rotate_spotify_credentials(uuid, uuid, timestamptz, bytea, bytea, bytea, bytea, integer, timestamptz)',
    'public.mark_spotify_connection_expired(uuid)',
    'public.disconnect_spotify(uuid)'
  ]
  loop
    target := format('function %s', signature);
    execute format('revoke all on %s from public', target);
    execute format('revoke all on %s from anon', target);
    execute format('revoke all on %s from authenticated', target);
    execute format('grant execute on %s to service_role', target);
  end loop;
end;
$$;

commit;
