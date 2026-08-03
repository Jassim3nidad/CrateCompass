begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;

create or replace function private.prevent_owner_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'The row owner cannot be changed.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 2048),
  preferred_ai_provider text not null default 'openai'
    check (preferred_ai_provider in ('openai', 'anthropic')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.spotify_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  spotify_user_id text not null check (char_length(spotify_user_id) between 1 and 255),
  display_name text check (display_name is null or char_length(display_name) <= 255),
  scopes text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'expired', 'revoked')),
  connected_at timestamptz not null default timezone('utc', now()),
  last_verified_at timestamptz,
  disconnected_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id),
  unique (spotify_user_id),
  unique (id, user_id),
  check ((status = 'revoked') = (disconnected_at is not null))
);

create table private.spotify_credentials (
  connection_id uuid primary key references public.spotify_connections(id) on delete cascade,
  access_token_ciphertext bytea not null,
  access_token_nonce bytea not null,
  refresh_token_ciphertext bytea not null,
  refresh_token_nonce bytea not null,
  encryption_key_version integer not null check (encryption_key_version > 0),
  token_expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table private.spotify_oauth_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  state_digest bytea not null unique,
  code_verifier_ciphertext bytea not null,
  code_verifier_nonce bytea not null,
  encryption_key_version integer not null check (encryption_key_version > 0),
  redirect_path text not null default '/settings'
    check (redirect_path ~ '^/[A-Za-z0-9/_-]*$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.favorite_discoveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  artist_name text not null check (char_length(artist_name) between 1 and 255),
  recording_name text check (recording_name is null or char_length(recording_name) <= 500),
  canonical_artist_id text check (canonical_artist_id is null or char_length(canonical_artist_id) <= 255),
  canonical_recording_id text check (canonical_recording_id is null or char_length(canonical_recording_id) <= 255),
  source_type text not null check (source_type in ('artist', 'mood', 'discography', 'manual')),
  source_reference text check (source_reference is null or char_length(source_reference) <= 1000),
  note text check (note is null or char_length(note) <= 2000),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.discovery_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  input_kind text not null check (input_kind in ('artist', 'mood')),
  input_value text not null check (char_length(input_value) between 1 and 500),
  status text not null default 'pending' check (status in ('pending', 'complete', 'failed')),
  failure_code text check (failure_code is null or char_length(failure_code) <= 100),
  created_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, user_id),
  check ((status = 'complete') = (completed_at is not null)),
  check (status = 'failed' or failure_code is null)
);

create table public.discovery_results (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  rank integer not null check (rank > 0),
  artist_name text not null check (char_length(artist_name) between 1 and 255),
  recording_name text check (recording_name is null or char_length(recording_name) <= 500),
  canonical_artist_id text check (canonical_artist_id is null or char_length(canonical_artist_id) <= 255),
  canonical_recording_id text check (canonical_recording_id is null or char_length(canonical_recording_id) <= 255),
  rationale text not null check (char_length(rationale) between 1 and 2000),
  source_provider text not null check (source_provider in ('musicbrainz', 'lastfm', 'listenbrainz', 'openai', 'anthropic')),
  source_reference text check (source_reference is null or char_length(source_reference) <= 1000),
  created_at timestamptz not null default timezone('utc', now()),
  foreign key (session_id, user_id)
    references public.discovery_sessions(id, user_id) on delete cascade,
  unique (session_id, rank),
  unique (id, user_id)
);

create table public.generated_playlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  discovery_session_id uuid,
  name text not null check (char_length(name) between 1 and 255),
  description text check (description is null or char_length(description) <= 1000),
  spotify_playlist_id text check (spotify_playlist_id is null or char_length(spotify_playlist_id) <= 255),
  status text not null default 'draft' check (status in ('draft', 'creating', 'created', 'failed')),
  failure_code text check (failure_code is null or char_length(failure_code) <= 100),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  foreign key (discovery_session_id, user_id)
    references public.discovery_sessions(id, user_id) on delete set null (discovery_session_id),
  unique (spotify_playlist_id)
);

create table public.discography_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  canonical_artist_id text not null check (char_length(canonical_artist_id) between 1 and 255),
  artist_name text not null check (char_length(artist_name) between 1 and 255),
  title text not null check (char_length(title) between 1 and 255),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, user_id)
);

create table public.discography_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 12000),
  ai_provider text check (ai_provider is null or ai_provider in ('openai', 'anthropic')),
  ai_model text check (ai_model is null or char_length(ai_model) <= 255),
  created_at timestamptz not null default timezone('utc', now()),
  foreign key (conversation_id, user_id)
    references public.discography_conversations(id, user_id) on delete cascade,
  check ((role = 'assistant') = (ai_provider is not null))
);

create table private.idempotency_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  operation text not null check (char_length(operation) between 1 and 100),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 255),
  request_digest bytea not null,
  response_status integer check (response_status between 100 and 599),
  response_body jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (user_id, operation, idempotency_key)
);

create table private.security_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (char_length(event_type) between 1 and 100),
  outcome text not null check (outcome in ('allowed', 'denied', 'failed')),
  request_id text check (request_id is null or char_length(request_id) <= 255),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index spotify_connections_user_id_idx on public.spotify_connections(user_id);
create index favorite_discoveries_user_created_idx on public.favorite_discoveries(user_id, created_at desc);
create index discovery_sessions_user_created_idx on public.discovery_sessions(user_id, created_at desc);
create index discovery_results_user_session_idx on public.discovery_results(user_id, session_id);
create index generated_playlists_user_created_idx on public.generated_playlists(user_id, created_at desc);
create index discography_conversations_user_updated_idx on public.discography_conversations(user_id, updated_at desc);
create index discography_messages_user_conversation_created_idx on public.discography_messages(user_id, conversation_id, created_at);
create index spotify_oauth_transactions_expiry_idx on private.spotify_oauth_transactions(expires_at) where consumed_at is null;
create index idempotency_records_expiry_idx on private.idempotency_records(expires_at);
create index security_events_user_created_idx on private.security_events(user_id, created_at desc);

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger spotify_connections_set_updated_at before update on public.spotify_connections
for each row execute function public.set_updated_at();
create trigger favorite_discoveries_set_updated_at before update on public.favorite_discoveries
for each row execute function public.set_updated_at();
create trigger discovery_sessions_set_updated_at before update on public.discovery_sessions
for each row execute function public.set_updated_at();
create trigger generated_playlists_set_updated_at before update on public.generated_playlists
for each row execute function public.set_updated_at();
create trigger discography_conversations_set_updated_at before update on public.discography_conversations
for each row execute function public.set_updated_at();
create trigger spotify_credentials_set_updated_at before update on private.spotify_credentials
for each row execute function public.set_updated_at();

create trigger spotify_connections_owner_immutable before update on public.spotify_connections
for each row execute function private.prevent_owner_change();
create trigger favorite_discoveries_owner_immutable before update on public.favorite_discoveries
for each row execute function private.prevent_owner_change();
create trigger discovery_sessions_owner_immutable before update on public.discovery_sessions
for each row execute function private.prevent_owner_change();
create trigger discovery_results_owner_immutable before update on public.discovery_results
for each row execute function private.prevent_owner_change();
create trigger generated_playlists_owner_immutable before update on public.generated_playlists
for each row execute function private.prevent_owner_change();
create trigger discography_conversations_owner_immutable before update on public.discography_conversations
for each row execute function private.prevent_owner_change();
create trigger discography_messages_owner_immutable before update on public.discography_messages
for each row execute function private.prevent_owner_change();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate_name text;
begin
  candidate_name := nullif(trim(left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 80)), '');
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(candidate_name, left(split_part(coalesce(new.email, 'listener'), '@', 1), 80))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

insert into public.profiles (id, display_name)
select
  users.id,
  coalesce(
    nullif(trim(left(coalesce(users.raw_user_meta_data ->> 'display_name', ''), 80)), ''),
    left(split_part(coalesce(users.email, 'listener'), '@', 1), 80)
  )
from auth.users as users
on conflict (id) do nothing;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

alter table public.profiles enable row level security;
alter table public.spotify_connections enable row level security;
alter table public.favorite_discoveries enable row level security;
alter table public.discovery_sessions enable row level security;
alter table public.discovery_results enable row level security;
alter table public.generated_playlists enable row level security;
alter table public.discography_conversations enable row level security;
alter table public.discography_messages enable row level security;
alter table private.spotify_credentials enable row level security;
alter table private.spotify_oauth_transactions enable row level security;
alter table private.idempotency_records enable row level security;
alter table private.security_events enable row level security;

grant select, update on public.profiles to authenticated;
grant select on public.spotify_connections to authenticated;
grant select, insert, update, delete on public.favorite_discoveries to authenticated;
grant select, insert, update, delete on public.discovery_sessions to authenticated;
grant select, insert, update, delete on public.discovery_results to authenticated;
grant select, insert, update, delete on public.generated_playlists to authenticated;
grant select, insert, update, delete on public.discography_conversations to authenticated;
grant select, insert, update, delete on public.discography_messages to authenticated;

create policy profiles_select_own on public.profiles
for select to authenticated
using ((select auth.uid()) = id);
create policy profiles_update_own on public.profiles
for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy spotify_connections_select_own on public.spotify_connections
for select to authenticated
using ((select auth.uid()) = user_id);

create policy favorite_discoveries_select_own on public.favorite_discoveries
for select to authenticated using ((select auth.uid()) = user_id);
create policy favorite_discoveries_insert_own on public.favorite_discoveries
for insert to authenticated with check ((select auth.uid()) = user_id);
create policy favorite_discoveries_update_own on public.favorite_discoveries
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy favorite_discoveries_delete_own on public.favorite_discoveries
for delete to authenticated using ((select auth.uid()) = user_id);

create policy discovery_sessions_select_own on public.discovery_sessions
for select to authenticated using ((select auth.uid()) = user_id);
create policy discovery_sessions_insert_own on public.discovery_sessions
for insert to authenticated with check ((select auth.uid()) = user_id);
create policy discovery_sessions_update_own on public.discovery_sessions
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy discovery_sessions_delete_own on public.discovery_sessions
for delete to authenticated using ((select auth.uid()) = user_id);

create policy discovery_results_select_own on public.discovery_results
for select to authenticated using ((select auth.uid()) = user_id);
create policy discovery_results_insert_own on public.discovery_results
for insert to authenticated with check ((select auth.uid()) = user_id);
create policy discovery_results_update_own on public.discovery_results
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy discovery_results_delete_own on public.discovery_results
for delete to authenticated using ((select auth.uid()) = user_id);

create policy generated_playlists_select_own on public.generated_playlists
for select to authenticated using ((select auth.uid()) = user_id);
create policy generated_playlists_insert_own on public.generated_playlists
for insert to authenticated with check ((select auth.uid()) = user_id);
create policy generated_playlists_update_own on public.generated_playlists
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy generated_playlists_delete_own on public.generated_playlists
for delete to authenticated using ((select auth.uid()) = user_id);

create policy discography_conversations_select_own on public.discography_conversations
for select to authenticated using ((select auth.uid()) = user_id);
create policy discography_conversations_insert_own on public.discography_conversations
for insert to authenticated with check ((select auth.uid()) = user_id);
create policy discography_conversations_update_own on public.discography_conversations
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy discography_conversations_delete_own on public.discography_conversations
for delete to authenticated using ((select auth.uid()) = user_id);

create policy discography_messages_select_own on public.discography_messages
for select to authenticated using ((select auth.uid()) = user_id);
create policy discography_messages_insert_own on public.discography_messages
for insert to authenticated with check ((select auth.uid()) = user_id);
create policy discography_messages_update_own on public.discography_messages
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy discography_messages_delete_own on public.discography_messages
for delete to authenticated using ((select auth.uid()) = user_id);

commit;
