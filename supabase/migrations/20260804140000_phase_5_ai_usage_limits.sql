-- Phase 5 — per-user AI usage limits.
--
-- Counting lives in Postgres rather than in process memory because the app is
-- serverless: an in-memory counter resets on every cold start and is not shared
-- between instances, which makes a per-day cap unenforceable in practice.
--
-- The table is in `private` for the same reason as the Spotify credentials: it
-- is operational data no browser client has any reason to read, and PostgREST
-- does not expose that schema.

begin;

create table private.ai_usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('anthropic', 'openai')),
  operation text not null check (char_length(operation) between 1 and 64),
  created_at timestamptz not null default timezone('utc', now())
);

-- Serves both windows the limiter checks, newest first.
create index ai_usage_events_user_created_idx
  on private.ai_usage_events(user_id, created_at desc);

alter table private.ai_usage_events enable row level security;

-- Atomically decide and record in one statement.
--
-- Splitting this into a SELECT count followed by an INSERT would let two
-- concurrent requests both observe a count under the limit and both proceed.
-- The CTE evaluates the windows and the insert together, so a request either
-- claims a slot or is refused — never both.
create or replace function public.claim_ai_usage(
  p_user_id uuid,
  p_provider text,
  p_operation text,
  p_daily_limit integer,
  p_per_minute_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed boolean;
begin
  with windows as (
    select
      count(*) filter (
        where events.created_at > timezone('utc', now()) - interval '1 day'
      ) as daily_count,
      count(*) filter (
        where events.created_at > timezone('utc', now()) - interval '1 minute'
      ) as minute_count
    from private.ai_usage_events as events
    where events.user_id = p_user_id
  ),
  inserted as (
    insert into private.ai_usage_events (user_id, provider, operation)
    select p_user_id, p_provider, p_operation
    from windows
    where windows.daily_count < p_daily_limit
      and windows.minute_count < p_per_minute_limit
    returning 1
  )
  select exists (select 1 from inserted) into claimed;

  return claimed;
end;
$$;

-- Retention: usage events are operational data, not user history. Nothing
-- outside the two windows is ever read, so keeping more is a liability.
create or replace function public.purge_ai_usage_events()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  purged integer;
begin
  delete from private.ai_usage_events
  where created_at < timezone('utc', now()) - interval '2 days';

  get diagnostics purged = row_count;
  return purged;
end;
$$;

-- CREATE FUNCTION grants EXECUTE to PUBLIC by default. Without these revokes a
-- signed-in user could call claim_ai_usage over PostgREST RPC and burn through
-- another user's allowance, or hand themselves an unlimited one.
do $$
declare
  target text;
  signature text;
begin
  foreach signature in array array[
    'public.claim_ai_usage(uuid, text, text, integer, integer)',
    'public.purge_ai_usage_events()'
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
