# CrateCompass Database Plan

Status: Phase 0 design; no migration has been created  
Last reviewed: 2026-08-02

## Design principles

- Supabase Auth owns application identity; all user references target `auth.users(id)`.
- PostgreSQL stores application-owned records, not provider catalog mirrors.
- Every user-owned table has RLS enabled and forced where appropriate.
- Ownership is derived from `auth.uid()`, never accepted from a browser mutation.
- Sensitive connected-account credentials live in a non-exposed private schema, separate from user-readable connection metadata.
- Foreign keys and frequently filtered columns are indexed explicitly.
- All timestamps use `timestamptz` and server/database time.
- Enumerated values use constrained text or PostgreSQL enums selected during migration review; unsupported values fail closed.
- JSON is used only for genuinely variable structured data and is validated in application code plus database checks where practical.
- Every schema change is an ordered, repeatable Supabase migration.

## Schemas

### `public`

Contains user-facing application tables protected by RLS. Supabase's authenticated API may expose this schema, so it must never contain retrievable credential material.

### `private`

Contains OAuth credentials, one-time OAuth transactions, idempotency records, and operational security data. It is not exposed through the browser-facing Supabase API. Access is granted only to tightly scoped server/database roles and reviewed functions.

## Planned tables

### `public.profiles`

| Column | Type | Constraints/notes |
| --- | --- | --- |
| `id` | `uuid` | Primary key; references `auth.users(id)` on delete cascade |
| `display_name` | `text` | Nullable; bounded length |
| `avatar_url` | `text` | Nullable; application/user-selected URL, not a mirrored Spotify image |
| `preferred_ai_provider` | `text` | Nullable constrained value; preference is honored only when configured |
| `created_at` | `timestamptz` | Not null, default `now()` |
| `updated_at` | `timestamptz` | Not null, maintained by trigger |

Profiles are created idempotently from a reviewed Auth trigger or first-use transaction. The Auth trigger must set a fixed `search_path` and not copy unvalidated metadata blindly.

### `public.spotify_connections`

This table contains displayable status metadata only.

| Column | Type | Constraints/notes |
| --- | --- | --- |
| `id` | `uuid` | Primary key |
| `user_id` | `uuid` | Not null; references `auth.users(id)` on delete cascade |
| `spotify_account_id` | `text` | Immutable stable `account_id`; bounded; unique among active links as policy permits |
| `display_name` | `text` | Nullable, refreshed from Spotify rather than treated as canonical |
| `scopes` | `text[]` | Not null; values constrained/validated |
| `status` | `text` | `active`, `reauthorization_required`, or `disconnected` |
| `connected_at` | `timestamptz` | Not null |
| `last_refreshed_at` | `timestamptz` | Nullable |
| `disconnected_at` | `timestamptz` | Nullable; consistent with status check |
| `created_at` | `timestamptz` | Not null |
| `updated_at` | `timestamptz` | Not null |

Indexes/constraints:

- Index on `(user_id, status)`.
- Partial unique index allowing at most one active connection per user.
- Evaluate whether an active Spotify account may link to only one CrateCompass user; default is a unique active `spotify_account_id` to prevent accidental cross-linking.
- Users may read their row but may not directly insert, update, or delete connection rows from the browser. Trusted server operations manage lifecycle.

### `private.spotify_credentials`

| Column | Type | Constraints/notes |
| --- | --- | --- |
| `connection_id` | `uuid` | Primary key; references `public.spotify_connections(id)` on delete cascade |
| `encrypted_refresh_token` | `bytea` or bounded encoded `text` | Not null; authenticated encryption output only |
| `token_key_version` | `smallint` | Not null, positive |
| `token_fingerprint` | `text` | Optional keyed/non-reversible fingerprint for diagnostics, never raw hash of low-entropy material |
| `created_at` | `timestamptz` | Not null |
| `rotated_at` | `timestamptz` | Nullable |

The encryption key is not stored in PostgreSQL. Ciphertext includes algorithm/version context, nonce/IV, and authentication tag. Browser roles receive no privileges on the table or schema.

### `private.spotify_oauth_transactions`

| Column | Type | Constraints/notes |
| --- | --- | --- |
| `id` | `uuid` | Primary key |
| `user_id` | `uuid` | Not null; target signed-in user |
| `state_hash` | `text` | Unique, not raw state |
| `encrypted_code_verifier` | `bytea` or bounded encoded `text` | One-time PKCE verifier protection |
| `return_path` | `text` | Local allowlisted path only |
| `expires_at` | `timestamptz` | Not null; short-lived |
| `consumed_at` | `timestamptz` | Nullable; atomically set once |
| `created_at` | `timestamptz` | Not null |

Index `expires_at` for cleanup. State consumption is atomic and rejects expired, consumed, or wrong-user transactions.

### `public.favorite_discoveries`

| Column | Type | Constraints/notes |
| --- | --- | --- |
| `id` | `uuid` | Primary key |
| `user_id` | `uuid` | Not null; delete cascade |
| `entity_type` | `text` | Constrained: `artist`, `release_group`, `track_candidate`, `explanation` |
| `musicbrainz_id` | `uuid` | Nullable; required for canonical artist/release-group types |
| `external_provider` | `text` | Nullable constrained provider |
| `external_provider_id` | `text` | Nullable, bounded |
| `display_name` | `text` | Not null, bounded |
| `user_note` | `text` | Nullable, bounded |
| `source_attribution` | `jsonb` | Not null, schema-versioned, no raw payload |
| `created_at` | `timestamptz` | Not null |
| `updated_at` | `timestamptz` | Not null |

Indexes on `(user_id, created_at desc)`, `(user_id, entity_type)`, and `(user_id, musicbrainz_id)` where non-null. Add an explicit uniqueness rule after UX decisions on duplicates/notes.

### `public.discovery_sessions`

| Column | Type | Constraints/notes |
| --- | --- | --- |
| `id` | `uuid` | Primary key |
| `user_id` | `uuid` | Not null; delete cascade |
| `discovery_type` | `text` | `artist_similarity` or `mood` |
| `input_text` | `text` | User-authored, bounded |
| `normalized_input` | `jsonb` | Validated application criteria, not Spotify-derived |
| `discovery_provider` | `text` | Constrained |
| `status` | `text` | `pending`, `needs_clarification`, `complete`, `partial`, `failed`, `cancelled` |
| `error_code` | `text` | Nullable safe application code |
| `created_at` | `timestamptz` | Not null |
| `completed_at` | `timestamptz` | Nullable |

Indexes on `(user_id, created_at desc)` and `(user_id, status)`. Do not persist raw Spotify resolutions in `normalized_input`.

### `public.discovery_results`

| Column | Type | Constraints/notes |
| --- | --- | --- |
| `id` | `uuid` | Primary key |
| `session_id` | `uuid` | Not null; references discovery session on delete cascade |
| `user_id` | `uuid` | Not null; denormalized ownership for simple RLS, guarded against mismatch |
| `result_kind` | `text` | `artist` or `track_candidate` |
| `position` | `integer` | Non-negative |
| `musicbrainz_id` | `uuid` | Nullable |
| `provider` | `text` | Not null |
| `provider_id` | `text` | Nullable |
| `display_name` | `text` | Not null |
| `evidence` | `jsonb` | Bounded normalized evidence and provenance |
| `match_status` | `text` | `not_attempted`, `confident`, `ambiguous`, `unresolved` |
| `created_at` | `timestamptz` | Not null |

Use a composite foreign key or trigger/function design to ensure `user_id` equals the parent session owner. Unique `(session_id, position)`.

### `public.generated_playlists`

| Column | Type | Constraints/notes |
| --- | --- | --- |
| `id` | `uuid` | Primary key |
| `user_id` | `uuid` | Not null; delete cascade |
| `discovery_session_id` | `uuid` | Nullable; ownership-consistent foreign key |
| `spotify_playlist_id` | `text` | Nullable until created; operational ID only |
| `playlist_name` | `text` | Not null, bounded |
| `mood_summary` | `text` | Nullable; application/AI output from approved input |
| `visibility` | `text` | `private` or `public` |
| `status` | `text` | `draft`, `creating`, `partial`, `created`, `failed` |
| `item_count_requested` | `integer` | Non-negative |
| `item_count_added` | `integer` | Non-negative and not greater than requested |
| `safe_error_code` | `text` | Nullable |
| `created_at` | `timestamptz` | Not null |
| `updated_at` | `timestamptz` | Not null |

Indexes on `(user_id, created_at desc)`, `(user_id, status)`, and a partial unique Spotify playlist ID where non-null. Do not store playlist contents or full Spotify playlist payloads here.

### `private.idempotency_records`

| Column | Type | Constraints/notes |
| --- | --- | --- |
| `user_id` | `uuid` | Not null |
| `operation` | `text` | Not null, constrained |
| `idempotency_key_hash` | `text` | Not null |
| `request_fingerprint` | `text` | Not null |
| `resource_id` | `uuid` | Nullable application record ID |
| `status` | `text` | `in_progress`, `succeeded`, `failed_retryable`, `failed_terminal` |
| `expires_at` | `timestamptz` | Not null |
| `created_at` | `timestamptz` | Not null |
| `updated_at` | `timestamptz` | Not null |

Composite primary key `(user_id, operation, idempotency_key_hash)`. A repeated key with a different fingerprint is rejected.

### `public.discography_conversations`

| Column | Type | Constraints/notes |
| --- | --- | --- |
| `id` | `uuid` | Primary key |
| `user_id` | `uuid` | Not null; delete cascade |
| `musicbrainz_artist_id` | `uuid` | Not null |
| `title` | `text` | Not null, bounded |
| `created_at` | `timestamptz` | Not null |
| `updated_at` | `timestamptz` | Not null |

Indexes on `(user_id, updated_at desc)` and `(user_id, musicbrainz_artist_id)`.

### `public.discography_messages`

| Column | Type | Constraints/notes |
| --- | --- | --- |
| `id` | `uuid` | Primary key |
| `conversation_id` | `uuid` | Not null; delete cascade |
| `user_id` | `uuid` | Not null; ownership-consistent with conversation |
| `role` | `text` | `user` or `assistant` only |
| `content` | `text` | Not null, bounded by role |
| `source_references` | `jsonb` | Not null default `[]`; application schema, MusicBrainz only for factual answers |
| `ai_provider` | `text` | Nullable for assistant messages |
| `model_alias` | `text` | Nullable environment alias/version metadata, not secret |
| `created_at` | `timestamptz` | Not null |

Indexes on `(conversation_id, created_at)` and `(user_id, created_at desc)`. The ownership duplication must be constrained to the parent owner.

### `private.security_events`

Contains redacted events such as OAuth replay rejection, AI-boundary rejection, repeated authorization denial, and account-deletion outcome. It contains safe codes and correlation identifiers, not raw inputs, tokens, or provider payloads. Access is service-only and retention is short/documented.

## Row Level Security (RLS) policy design

For each public user-owned table:

- Enable RLS before any grants or application use.
- `SELECT` uses `user_id = auth.uid()` or `id = auth.uid()` for profiles.
- `INSERT` requires `user_id = auth.uid()` and all parent records to have the same owner.
- `UPDATE` uses both `USING` and `WITH CHECK` ownership clauses.
- `DELETE` requires ownership.
- Revoke direct mutation privileges for server-managed tables such as Spotify connections and generated-playlist lifecycle fields; expose narrow authenticated server operations.

Ownership columns are immutable. Prefer composite foreign keys such as `(conversation_id, user_id)` referencing a unique parent pair, so RLS is not the only protection against inconsistent ownership.

RLS tests must cover anonymous access, owner CRUD, cross-user CRUD, ownership-field mutation, child-to-other-user-parent insertion, and service-only table access.

## Functions and triggers

Planned functions/triggers, each with fixed `search_path`, minimum privileges, and tests:

- `set_updated_at()` before-update trigger.
- Optional idempotent profile creation on Auth user creation.
- Ownership-consistent insert/update helpers only if constraints cannot express the rule.
- Account-deletion function that deletes application records; Auth deletion remains a narrow server operation.
- Cleanup functions for expired OAuth/idempotency records, invoked by a controlled scheduler.

Avoid `security definer` unless necessary. Any such function must revoke public execution and validate `auth.uid()` or accept calls only from a service role.

## Deletion behavior

- User-owned foreign keys default to `on delete cascade` from `auth.users` where Supabase supports the intended lifecycle.
- Spotify ciphertext is destroyed before or within connection/account deletion.
- Generated playlist records may be deleted locally; this does not delete the external Spotify playlist unless the user separately performs a supported, explicit action.
- Security records retain no direct secret and follow the approved retention schedule.
- Provider caches are not user-owned unless personalized; personalized cache entries are deleted with the user.

## Migration and verification plan

1. Create schemas, types/check constraints, tables, foreign keys, and indexes.
2. Enable RLS and add policies in the same migration that introduces each user-owned table.
3. Revoke access to private schema and server-managed columns/tables.
4. Add functions/triggers with fixed `search_path` and explicit grants.
5. Generate TypeScript database types from the migrated local database.
6. Run migrations from an empty local database twice through reset/reapply workflows.
7. Run pgTAP or equivalent SQL tests for constraints, RLS, and security-definer behavior.
8. Verify query plans for history, library, conversation, and connection-status reads.
9. Document rollback/forward-fix strategy; production schema is never modified manually.

## Decisions deferred to implementation review

- Exact enum-versus-check strategy.
- Approved default history retention period.
- Whether favorites allow duplicate canonical entities with separate notes.
- Whether provider-normalized evidence is persisted or reconstructed, subject to Last.fm terms.
- Encryption algorithm/library and key-management service.
- Background scheduler/job provider.
