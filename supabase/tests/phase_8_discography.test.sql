-- Phase 8 — discography conversations and the usage-remaining RPC.
--
-- The Phase 2 file asserts that Row Level Security is *enabled* on these two
-- tables. Enabled is not isolated: these assertions sign in as two listeners
-- and check that neither can read, alter, or delete the other's conversation,
-- that a message cannot be attached to someone else's conversation, and that
-- deleting an account takes its conversations with it.
--
-- Also covered: the new read_ai_usage_remaining function must not be reachable
-- from the browser-facing roles. It reports how heavily an account is being
-- used, and it takes a user id as an argument.

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
  'public', 'discography_conversations', 'conversations table exists'
);
insert into pg_temp.tap_output (result) select has_table(
  'public', 'discography_messages', 'messages table exists'
);

insert into pg_temp.tap_output (result) select ok(
  (
    select c.relrowsecurity
    from pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'discography_conversations'
  ),
  'RLS is enabled on conversations'
);
insert into pg_temp.tap_output (result) select ok(
  (
    select c.relrowsecurity
    from pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'discography_messages'
  ),
  'RLS is enabled on messages'
);

insert into pg_temp.tap_output (result) select ok(
  not has_table_privilege('anon', 'public.discography_conversations', 'SELECT'),
  'anonymous clients have no conversations grant'
);
insert into pg_temp.tap_output (result) select ok(
  not has_table_privilege('anon', 'public.discography_messages', 'SELECT'),
  'anonymous clients have no messages grant'
);

-- The quota function takes a user id, so EXECUTE from a browser-facing role
-- would let a signed-in listener probe another account's usage.
insert into pg_temp.tap_output (result) select ok(
  not has_function_privilege(
    'authenticated',
    'public.read_ai_usage_remaining(uuid,integer)',
    'execute'
  ),
  'authenticated cannot read usage remaining directly'
);
insert into pg_temp.tap_output (result) select ok(
  not has_function_privilege(
    'anon',
    'public.read_ai_usage_remaining(uuid,integer)',
    'execute'
  ),
  'anon cannot read usage remaining'
);
insert into pg_temp.tap_output (result) select ok(
  has_function_privilege(
    'service_role',
    'public.read_ai_usage_remaining(uuid,integer)',
    'execute'
  ),
  'service_role can read usage remaining'
);
insert into pg_temp.tap_output (result) select ok(
  (
    select coalesce(p.proconfig::text like '%search_path=%', false)
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'read_ai_usage_remaining'
  ),
  'read_ai_usage_remaining pins search_path'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '81111111-1111-4111-8111-111111111111',
    'authenticated', 'authenticated', 'discography-one@cratecompass.test',
    crypt('not-a-real-password', gen_salt('bf')), timezone('utc', now()),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Discography One"}'::jsonb,
    timezone('utc', now()), timezone('utc', now())
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '82222222-2222-4222-8222-222222222222',
    'authenticated', 'authenticated', 'discography-two@cratecompass.test',
    crypt('not-a-real-password', gen_salt('bf')), timezone('utc', now()),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Discography Two"}'::jsonb,
    timezone('utc', now()), timezone('utc', now())
  );

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"81111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);

insert into pg_temp.tap_output (result) select lives_ok(
  $$
    insert into public.discography_conversations
      (id, user_id, canonical_artist_id, artist_name, title)
    values (
      '8a000000-0000-4000-8000-000000000001',
      '81111111-1111-4111-8111-111111111111',
      '8f5c2c1e-0e2a-4a5f-9a1b-2c3d4e5f6a7b',
      'Portishead',
      'What was their first studio album?'
    )
  $$,
  'a listener can start a conversation'
);

insert into pg_temp.tap_output (result) select lives_ok(
  $$
    insert into public.discography_messages
      (conversation_id, user_id, role, content)
    values (
      '8a000000-0000-4000-8000-000000000001',
      '81111111-1111-4111-8111-111111111111',
      'user',
      'What was their first studio album?'
    )
  $$,
  'a listener can record their own question'
);

-- The check constraint ties ai_provider to the assistant role, which is what
-- keeps "which model said this" answerable for every stored answer.
insert into pg_temp.tap_output (result) select throws_ok(
  $$
    insert into public.discography_messages
      (conversation_id, user_id, role, content)
    values (
      '8a000000-0000-4000-8000-000000000001',
      '81111111-1111-4111-8111-111111111111',
      'assistant',
      'Dummy, in 1994.'
    )
  $$,
  23514,
  null,
  'an assistant message without a provider is rejected'
);

insert into pg_temp.tap_output (result) select lives_ok(
  $$
    insert into public.discography_messages
      (conversation_id, user_id, role, content, ai_provider, ai_model)
    values (
      '8a000000-0000-4000-8000-000000000001',
      '81111111-1111-4111-8111-111111111111',
      'assistant',
      'Dummy, in 1994.',
      'gemini',
      'gemini-2.5-flash'
    )
  $$,
  'an assistant message with a provider is accepted'
);

-- Now as the other listener. Everything below must be invisible or refused.
select set_config(
  'request.jwt.claims',
  '{"sub":"82222222-2222-4222-8222-222222222222","role":"authenticated"}',
  true
);

insert into pg_temp.tap_output (result) select is(
  (select count(*)::integer from public.discography_conversations),
  0,
  'another listener cannot see the conversation'
);

insert into pg_temp.tap_output (result) select is(
  (select count(*)::integer from public.discography_messages),
  0,
  'another listener cannot see the messages'
);

-- Attempted as the second listener. Under RLS these match no rows rather than
-- raising, so the assertion is made afterwards, as the owner: the check that
-- matters is that the data survived, not that the statement was refused.
update public.discography_conversations
set title = 'Retitled by someone else'
where id = '8a000000-0000-4000-8000-000000000001';

delete from public.discography_messages
where conversation_id = '8a000000-0000-4000-8000-000000000001';

-- Writing into someone else's conversation must fail the owner-scoped foreign
-- key rather than succeed as an orphan attributed to the wrong person.
insert into pg_temp.tap_output (result) select throws_ok(
  $$
    insert into public.discography_messages
      (conversation_id, user_id, role, content)
    values (
      '8a000000-0000-4000-8000-000000000001',
      '82222222-2222-4222-8222-222222222222',
      'user',
      'Injected into another conversation'
    )
  $$,
  23503,
  null,
  'a message cannot be attached to another listener conversation'
);

-- Back as the owner, to see what the attempts above actually did.
select set_config(
  'request.jwt.claims',
  '{"sub":"81111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);

insert into pg_temp.tap_output (result) select is(
  (
    select title
    from public.discography_conversations
    where id = '8a000000-0000-4000-8000-000000000001'
  ),
  'What was their first studio album?',
  'another listener cannot retitle the conversation'
);

insert into pg_temp.tap_output (result) select is(
  (
    select count(*)::integer
    from public.discography_messages
    where conversation_id = '8a000000-0000-4000-8000-000000000001'
  ),
  2,
  'another listener cannot delete the messages'
);

reset role;

delete from auth.users where id = '81111111-1111-4111-8111-111111111111';

insert into pg_temp.tap_output (result) select is(
  (
    select count(*)::integer
    from public.discography_conversations
    where id = '8a000000-0000-4000-8000-000000000001'
  ),
  0,
  'deleting the account removes its conversations'
);

delete from auth.users where id = '82222222-2222-4222-8222-222222222222';

insert into pg_temp.tap_output (result)
select * from finish();

commit;

select result from pg_temp.tap_output order by sequence;
