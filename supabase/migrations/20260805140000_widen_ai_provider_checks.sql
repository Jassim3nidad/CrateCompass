-- Teach the remaining provider checks about Gemini and OpenRouter.
--
-- Three columns still enumerate only the two adapters that existed in Phase 2.
-- The application has supported four since Phase 5, and `private.ai_usage_events`
-- was already widened twice for exactly this reason (see the 20260804150000 and
-- 20260804160000 migrations). These three were missed.
--
-- Nothing writes to them yet, which is why this has not surfaced as a failure:
-- Phase 8 writes `discography_messages.ai_provider` and Phase 9 writes
-- `discovery_results.source_provider`. Widening now means neither phase opens
-- with a constraint violation on the default provider, and it keeps the four
-- adapters representable in one place rather than three.
--
-- `profiles.preferred_ai_provider` keeps its 'openai' default: changing a
-- default is a product decision about what a new account gets, not a schema
-- correction, and it belongs with the settings work in Phase 9.

begin;

alter table public.profiles
  drop constraint profiles_preferred_ai_provider_check;

alter table public.profiles
  add constraint profiles_preferred_ai_provider_check
  check (preferred_ai_provider in ('openai', 'anthropic', 'openrouter', 'gemini'));

alter table public.discovery_results
  drop constraint discovery_results_source_provider_check;

alter table public.discovery_results
  add constraint discovery_results_source_provider_check
  check (
    source_provider in (
      'musicbrainz', 'lastfm', 'listenbrainz',
      'openai', 'anthropic', 'openrouter', 'gemini'
    )
  );

alter table public.discography_messages
  drop constraint discography_messages_ai_provider_check;

alter table public.discography_messages
  add constraint discography_messages_ai_provider_check
  check (
    ai_provider is null
    or ai_provider in ('openai', 'anthropic', 'openrouter', 'gemini')
  );

commit;
