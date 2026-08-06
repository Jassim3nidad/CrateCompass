-- Phase 8 — discography explorer and Q&A
--
-- One function, no table changes. The conversation tables were created in
-- Phase 2 with Row Level Security and owner-immutable triggers, and Phase 8 is
-- the first phase to write to them; nothing about their shape needs to change.
--
-- What is new is a way to read how much of a listener's daily AI allowance is
-- left. `private.ai_usage_events` is not reachable by `service_role` — it has no
-- USAGE on the schema and no table grants, deliberately — and the two existing
-- functions over it either consume a slot (`claim_ai_usage`) or delete history
-- (`purge_ai_usage_events`). Neither reports a count.
--
-- Retention is unchanged. Decision 3 of the Phase 8 scoping keeps every
-- conversation until Phase 9 owns deletion controls, so there is no TTL, no cap
-- and no purge job here. The roadmap records the condition for revisiting that.

begin;

-- Reads only. Counting is deliberately separate from claiming: a display that
-- consumed a slot to render itself would be a limiter that penalises looking at
-- the limiter.
create or replace function public.read_ai_usage_remaining(
  p_user_id uuid,
  p_daily_limit integer
)
returns integer
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  used integer;
begin
  select count(*)
  into used
  from private.ai_usage_events as events
  where events.user_id = p_user_id
    and events.created_at > timezone('utc', now()) - interval '1 day';

  -- Never negative. A limit lowered while a listener was mid-conversation would
  -- otherwise render as a negative allowance rather than as none left.
  return greatest(p_daily_limit - used, 0);
end;
$$;

-- CREATE FUNCTION grants EXECUTE to PUBLIC by default. Without these revokes a
-- signed-in user could call this over PostgREST RPC with someone else's user id
-- and learn how heavily that account is being used.
do $$
declare
  target text;
begin
  target := 'function public.read_ai_usage_remaining(uuid, integer)';
  execute format('revoke all on %s from public', target);
  execute format('revoke all on %s from anon', target);
  execute format('revoke all on %s from authenticated', target);
  execute format('grant execute on %s to service_role', target);
end;
$$;

commit;
