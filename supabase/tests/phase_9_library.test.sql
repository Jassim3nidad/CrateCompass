-- Phase 9 — library, history, and the enumeration that makes deletion checkable.
--
-- Three groups of assertions, and the middle one is the reason this file
-- matters most.
--
-- 1. The tag trigger normalises, because a per-element rule is not expressible
--    as a CHECK constraint and therefore cannot be assumed.
--
-- 2. `export_user_data` covers every user-owned table *and every column of the
--    tables this phase changed*. A table-level check alone would have passed
--    while the export silently omitted `tags` and the explanation snapshot,
--    since both were added to a table that already existed. The export selects
--    whole rows precisely so a new column cannot be forgotten, and this is
--    where that property is proved rather than asserted in a comment.
--
--    Ownership is "has a foreign key to auth.users", not "has a column named
--    user_id". `profiles` keys on `id`, so a column-name rule would have
--    excluded it from the check entirely.
--
-- 3. Deleting a row removes it from the table rather than hiding it, and
--    deleting an account leaves the export empty. The second is threat T23.

begin;

create extension if not exists pgtap with schema extensions;

select plan(19);

create temporary table tap_output (
  sequence bigint generated always as identity,
  result text not null
) on commit preserve rows;

grant select, insert on pg_temp.tap_output to anon, authenticated;
grant usage, select on sequence pg_temp.tap_output_sequence_seq to anon, authenticated;

insert into pg_temp.tap_output (result) select ok(
  not has_function_privilege(
    'authenticated', 'public.export_user_data(uuid)', 'execute'
  ),
  'authenticated cannot enumerate a user''s data directly'
);
insert into pg_temp.tap_output (result) select ok(
  not has_function_privilege('anon', 'public.export_user_data(uuid)', 'execute'),
  'anon cannot enumerate a user''s data'
);
insert into pg_temp.tap_output (result) select ok(
  has_function_privilege(
    'service_role', 'public.export_user_data(uuid)', 'execute'
  ),
  'service_role can enumerate a user''s data'
);
insert into pg_temp.tap_output (result) select ok(
  (
    select coalesce(p.proconfig::text like '%search_path=%', false)
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'export_user_data'
  ),
  'export_user_data pins search_path'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  '91111111-1111-4111-8111-111111111111',
  'authenticated', 'authenticated', 'library-one@cratecompass.test',
  crypt('not-a-real-password', gen_salt('bf')), timezone('utc', now()),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Library One"}'::jsonb,
  timezone('utc', now()), timezone('utc', now())
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"91111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);

-- Tag normalisation. The trigger exists because CHECK cannot contain a
-- subquery, so none of this is enforced by the column definition.
insert into public.favorite_discoveries
  (id, user_id, artist_name, source_type, tags, note)
values (
  '9a000000-0000-4000-8000-000000000001',
  '91111111-1111-4111-8111-111111111111',
  'Portishead',
  'artist',
  array['  Trip Hop  ', 'TRIP HOP', 'trip hop', '', '   ', 'Bristol'],
  'Kept for the low end.'
);

insert into pg_temp.tap_output (result) select is(
  (
    select tags from public.favorite_discoveries
    where id = '9a000000-0000-4000-8000-000000000001'
  ),
  array['bristol', 'trip hop'],
  'tags are trimmed, lowercased, deduplicated and emptied of blanks'
);

insert into pg_temp.tap_output (result) select throws_ok(
  $$
    insert into public.favorite_discoveries (user_id, artist_name, source_type, tags)
    values (
      '91111111-1111-4111-8111-111111111111',
      'Too Many Tags',
      'artist',
      array['a','b','c','d','e','f','g','h','i','j','k','l','m','n','o','p','q','r','s','t','u']
    )
  $$,
  23514,
  null,
  'more than twenty tags is rejected'
);

-- A snapshot must carry the version needed to render it.
insert into pg_temp.tap_output (result) select throws_ok(
  $$
    insert into public.favorite_discoveries
      (user_id, artist_name, source_type, explanation)
    values (
      '91111111-1111-4111-8111-111111111111',
      'Unversioned',
      'artist',
      '{"summary":"x"}'::jsonb
    )
  $$,
  23514,
  null,
  'an explanation without its version is rejected'
);

-- An AI explanation must name the model that wrote it.
insert into pg_temp.tap_output (result) select throws_ok(
  $$
    insert into public.favorite_discoveries
      (user_id, artist_name, source_type, explanation, explanation_version, explanation_source)
    values (
      '91111111-1111-4111-8111-111111111111',
      'Unattributed',
      'artist',
      '{"summary":"x"}'::jsonb,
      1,
      'ai'
    )
  $$,
  23514,
  null,
  'an AI explanation without a provider is rejected'
);

update public.favorite_discoveries
set explanation = '{"summary":"Shares a hazy low end.","sharedCharacteristics":[],"contrast":null,"startingPoint":null}'::jsonb,
    explanation_version = 1,
    explanation_source = 'ai',
    explanation_provider = 'gemini',
    explanation_model = 'gemini-2.5-flash'
where id = '9a000000-0000-4000-8000-000000000001';

insert into public.discovery_sessions (id, user_id, input_kind, input_value)
values (
  '9b000000-0000-4000-8000-000000000001',
  '91111111-1111-4111-8111-111111111111',
  'discography',
  '8f6bd1e4-fbe1-4f50-aa9b-94c450ec0f11'
);

insert into pg_temp.tap_output (result) select lives_ok(
  $$
    insert into public.discovery_sessions (user_id, input_kind, input_value)
    values (
      '91111111-1111-4111-8111-111111111111', 'discography', 'another-artist'
    )
  $$,
  'discography is an accepted history kind'
);

reset role;

-- Every user-owned table must appear in the export. Ownership is a foreign key
-- to auth.users, not a column name: profiles keys on id, and a name-based rule
-- would silently exclude it.
insert into pg_temp.tap_output (result) select is(
  (
    select array_agg(missing::text order by missing::text)
    from (
      select src.relname as missing
      from pg_constraint con
      join pg_class src on src.oid = con.conrelid
      join pg_namespace sn on sn.oid = src.relnamespace
      join pg_class tgt on tgt.oid = con.confrelid
      join pg_namespace tn on tn.oid = tgt.relnamespace
      where con.contype = 'f'
        and sn.nspname = 'public'
        and tn.nspname = 'auth'
        and tgt.relname = 'users'
        and not public.export_user_data(
          '91111111-1111-4111-8111-111111111111'
        ) ? src.relname
      group by src.relname
    ) as gaps
  ),
  null::text[],
  'every user-owned table appears in the export'
);

/*
 * Column coverage, which is the assertion a table-level check cannot make.
 *
 * `tags` and the explanation columns were added to a table that already
 * existed, so a test that only counted tables would have passed while the
 * export omitted them entirely.
 */
insert into pg_temp.tap_output (result) select is(
  (
    select array_agg(c.column_name::text order by c.column_name::text)
    from information_schema.columns as c
    where c.table_schema = 'public'
      and c.table_name = 'favorite_discoveries'
      and not (
        select public.export_user_data(
          '91111111-1111-4111-8111-111111111111'
        ) -> 'favorite_discoveries' -> 0 ? c.column_name
      )
  ),
  null::text[],
  'every favorite_discoveries column appears in the export, this phase''s included'
);

insert into pg_temp.tap_output (result) select ok(
  (
    select public.export_user_data('91111111-1111-4111-8111-111111111111')
      -> 'favorite_discoveries' -> 0 ? 'tags'
  ),
  'the tags column added by this phase is exported'
);

insert into pg_temp.tap_output (result) select ok(
  (
    select public.export_user_data('91111111-1111-4111-8111-111111111111')
      -> 'favorite_discoveries' -> 0 ? 'explanation'
  ),
  'the explanation snapshot added by this phase is exported'
);

insert into pg_temp.tap_output (result) select is(
  (
    select array_agg(c.column_name::text order by c.column_name::text)
    from information_schema.columns as c
    where c.table_schema = 'public'
      and c.table_name = 'discovery_sessions'
      and not (
        select public.export_user_data(
          '91111111-1111-4111-8111-111111111111'
        ) -> 'discovery_sessions' -> 0 ? c.column_name
      )
  ),
  null::text[],
  'every discovery_sessions column appears in the export'
);

-- The credential store is deliberately out of scope: a listener is entitled to
-- their library, not to their own refresh-token ciphertext.
insert into pg_temp.tap_output (result) select ok(
  not (
    public.export_user_data('91111111-1111-4111-8111-111111111111')
      ? 'spotify_credentials'
  ),
  'encrypted credentials are not part of an export'
);

-- Deletion is genuine. A row filtered out of a view would pass a "cannot see
-- it" check and fail this one, which is the point.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"91111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);

delete from public.favorite_discoveries
where id = '9a000000-0000-4000-8000-000000000001';

reset role;

insert into pg_temp.tap_output (result) select is(
  (
    select count(*)::integer from public.favorite_discoveries
    where id = '9a000000-0000-4000-8000-000000000001'
  ),
  0,
  'a removed favourite is absent from the table, not hidden by a filter'
);

insert into pg_temp.tap_output (result) select is(
  (
    select jsonb_array_length(
      public.export_user_data('91111111-1111-4111-8111-111111111111')
        -> 'favorite_discoveries'
    )
  ),
  0,
  'a removed favourite is absent from the export'
);

-- T23: account deletion leaves nothing behind.
delete from auth.users where id = '91111111-1111-4111-8111-111111111111';

insert into pg_temp.tap_output (result) select is(
  (
    select count(*)::integer
    from jsonb_each(
      public.export_user_data('91111111-1111-4111-8111-111111111111')
    ) as entry(key, value)
    where jsonb_array_length(entry.value) > 0
  ),
  0,
  'the export is empty for every table after account deletion'
);

insert into pg_temp.tap_output (result) select is(
  (
    select count(*)::integer from public.discovery_sessions
    where user_id = '91111111-1111-4111-8111-111111111111'
  ),
  0,
  'deleting the account removes its history'
);

insert into pg_temp.tap_output (result)
select * from finish();

commit;

select result from pg_temp.tap_output order by sequence;
