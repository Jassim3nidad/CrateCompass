-- Allow 'openrouter' as an AI usage provider.
--
-- The Phase 5 table constrained `provider` to the two adapters that existed
-- then. Adding the OpenRouter adapter without widening this check would make
-- every usage claim fail its insert, which — because the limiter fails closed —
-- would surface as every AI request being refused.

begin;

alter table private.ai_usage_events
  drop constraint ai_usage_events_provider_check;

alter table private.ai_usage_events
  add constraint ai_usage_events_provider_check
  check (provider in ('anthropic', 'openai', 'openrouter'));

commit;
