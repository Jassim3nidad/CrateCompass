# Data handling, export, and deletion

Status: current as of Phase 9 (2026-08-07)  
Related: [data-flow.md](../architecture/data-flow.md),
[threat-model.md](../security/threat-model.md),
[spotify-compliance.md](../compliance/spotify-compliance.md)

This document says what CrateCompass stores, how a listener gets a copy of it,
and how it is destroyed. It describes what the software actually does today. Where
a capability is planned rather than built, it says so.

## What is stored

Everything below belongs to one signed-in listener and is isolated by Row Level
Security. Cross-user isolation is asserted in `supabase/tests/`, not assumed.

| Table | What it holds | Removed when |
| --- | --- | --- |
| `profiles` | Display name, avatar URL, preferred AI provider | Account deleted |
| `favorite_discoveries` | Kept artists and recordings, notes, tags, and the explanation snapshot taken when each was saved | Item removed, or account deleted |
| `dismissed_discoveries` | Candidates hidden from a seed artist's results | Account deleted |
| `discovery_sessions` | What was asked: an artist search, a mood, or a discography conversation | History entry deleted, or account deleted |
| `discovery_results` | Candidates a discovery returned, with the provider's ranking | Cascades with its session |
| `generated_playlists` | The record that a playlist was created, its Spotify id and URL | Account deleted |
| `generated_playlist_tracks` | Which recordings were intended and which resolved | Cascades with its playlist |
| `discography_conversations` | Questions asked about an artist's releases | History entry deleted, or account deleted |
| `discography_messages` | The questions and answers themselves, with the model that answered | Cascades with its conversation |
| `spotify_connections` | That an account is connected, its scopes and status | Disconnect, or account deleted |

Held separately, in a schema no browser-facing role can reach, and **not part of
an export**:

| Table | What it holds | Why it is excluded |
| --- | --- | --- |
| `private.spotify_credentials` | Encrypted access and refresh tokens | Returning a listener their own refresh-token ciphertext serves no purpose and creates a credential to lose |
| `private.ai_usage_events` | Metered AI request counts | Operational metering, purged after two days |
| `private.idempotency_records` | Duplicate-submission protection | Operational, short-lived |
| `private.security_events` | Redacted audit codes | Operational security, no listener content |

### What is deliberately not stored

- No mirrored Spotify catalogue. A playlist id and its URL are kept because
  repairing a half-created playlist requires knowing which one it was; nothing
  else from Spotify persists.
- No Spotify artwork, rehosted or otherwise.
- No AI training data. No listener content is used to train, fine-tune, or
  evaluate a model.

## Getting a copy of your data

**This is an operator-run process today. There is no export control in the
application.** A request is fulfilled by the person operating the deployment.

1. The listener asks the operator for their data.
2. The operator verifies the request is from the account holder.
3. The operator calls `export_user_data(<user id>)`, a database function that
   returns every row from the tables in the first table above as JSON.
4. The operator sends the JSON to the listener.

The function is reachable only by `service_role` — it is revoked from `anon` and
`authenticated`, because it takes a user id and would otherwise let any
signed-in listener enumerate another account.

**Planned, not built:** a self-service download. That belongs to Phase 12
alongside the privacy-policy draft. Until it ships, nothing in the interface
offers an export, and this document does not imply otherwise.

### Why the enumeration exists before the download

`export_user_data` selects whole rows rather than named columns, so a column
added to any of those tables is included automatically. That property is what
makes the coverage test meaningful: a table added later fails the test until it
is registered, and a new column cannot be silently omitted.

The same list is what account deletion must cover, which is why building it
early is worth more than the download it will eventually feed.

## Deleting things

### One saved item

Removing a favourite deletes the row. There is no `deleted_at` column and no
holding table — a row hidden from ordinary queries would still be a row.

Undo is offered for a short window and works by re-inserting what was removed
from browser state. **The restored item is a new row with a new date**, and the
interface says it was added back rather than restored. Closing the page ends the
window.

Bulk removal states how many items it will delete and offers no undo.

### History

A history entry can be deleted individually or all at once. Deleting a
conversation entry deletes its questions and answers.

**Deleting history does not delete a playlist from Spotify.** A playlist created
in a listener's Spotify account belongs to that account; CrateCompass records
that it made one and cannot remove it. The interface states this rather than
implying a deletion it cannot perform.

### Spotify connection

Disconnecting marks the connection inactive so refresh stops immediately, then
destroys the stored token ciphertext. Playlists already created remain in the
listener's Spotify account.

### The whole account

Account deletion requires recent authentication. It destroys Spotify token
material first, then removes every user-owned row by cascade, then deletes the
Supabase Auth user.

After deletion, `export_user_data` for that identifier returns nothing. That is
asserted as a test rather than described as an intention, and it is the
residual-data check recorded as T23 in the threat model.

## Retention

| Class | Retention |
| --- | --- |
| Library and history | Until the listener deletes them, or the account | 
| Discography conversations | Same. No TTL, no cap — see the roadmap tripwire for when that needs revisiting |
| Spotify credentials | Until disconnect, revocation, rotation, or account deletion |
| AI usage events | Two days, purged |
| Provider cache | In-memory, provider-policy TTL only |

Conversation retention is sized for a small pilot and is recorded in
`docs/project/implementation-roadmap.md` as needing review before the user base
grows.
