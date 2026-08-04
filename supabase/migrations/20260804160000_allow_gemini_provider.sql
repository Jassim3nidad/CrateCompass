-- Allow 'gemini' as an AI usage provider.
--
-- Same reasoning as the OpenRouter widening: the limiter fails closed, so a
-- provider missing from this check would make every AI request fail with a
-- misleading "limit reached" message rather than a configuration error.

begin;

alter table private.ai_usage_events
  drop constraint ai_usage_events_provider_check;

alter table private.ai_usage_events
  add constraint ai_usage_events_provider_check
  check (provider in ('anthropic', 'openai', 'openrouter', 'gemini'));

commit;
