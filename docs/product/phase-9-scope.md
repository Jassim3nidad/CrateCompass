# Phase 9 — Saved discoveries, history, and data rights: scoping

Status: **proposed, not started — awaiting decisions on the open questions**  
Date: 2026-08-07  
Builds on: [phase-6-discovery.md](phase-6-discovery.md),
[phase-7-scope.md](phase-7-scope.md), [phase-8-plan.md](phase-8-plan.md)

## What Phase 9 promises

A listener can find what they kept, retrace how they found it, and take it all
away. Favourites, notes, saved explanations, generated playlists and discography
conversations become a library they can search and manage, a history they can
read and delete, and an export they can leave with.

## A defect to fix first

**Nothing writes `discovery_sessions` or `discovery_results`.**

`app/history/page.tsx` reads `discovery_sessions` and renders whatever comes
back. No feature module writes to it — verified by scanning the repository for
every reader and writer:

| Table | Written by | Read by |
| --- | --- | --- |
| `favorite_discoveries` | `features/discovery/repository.ts` | `app/library/page.tsx` |
| `dismissed_discoveries` | `features/discovery/repository.ts` | `features/discovery/repository.ts` |
| `discovery_sessions` | **nothing** | `app/history/page.tsx` |
| `discovery_results` | **nothing** | nothing |
| `generated_playlists` | `features/playlists/repository.ts` | Phase 7 flow only |
| `discography_conversations` | `features/discography/repository.ts` | the artist page only |

The consequence: **the history page is permanently empty and always has been.**
It is not broken in a way anyone would notice, because an empty history looks
exactly like a new account. That is the same shape as the silent 25-cap
truncation — a screen that is confidently wrong and gives no sign of it.

`discovery_results.rationale` and `source_provider` exist and are unused, which
means every Phase 6 explanation is regenerated on demand and none is kept.

**Deciding what history records is therefore the first Phase 9 decision, not a
detail of it.** See open question 3.

## What already exists

| Piece | State |
| --- | --- |
| `favorite_discoveries` with note, source type, canonical ids | Created Phase 2, written Phase 6 |
| `dismissed_discoveries` | Created Phase 2, written Phase 6 |
| `discovery_sessions` / `discovery_results` with RLS | Created Phase 2, **never written** |
| `generated_playlists` / `generated_playlist_tracks` | Written Phase 7 |
| `discography_conversations` / `discography_messages` | Written Phase 8 |
| Account deletion with cascade, password re-entry | Built in Phase 2, on `/settings` |
| Spotify disconnect, credentials destroyed | Built in Phase 3 |
| `/library` and `/history` routes | Phase 1/2 stubs: bare lists, no search, filters, or actions |
| Cross-user isolation for all of the above | pgTAP, 121 assertions |

Account deletion and disconnect — the two data rights that matter most — already
work. Phase 9 adds the granular controls around them, not the safety net.

## In scope

1. Library: search, filter by entity type and source, sort, tags, notes,
   remove, undo removal, bulk selection, empty state, cursor pagination.
2. History: what was asked, what was selected, which provider answered, the
   result status, any playlist created, and when — with deletion controls.
3. Recording sessions, so history has something truthful to show.
4. Saved explanations, so a kept discovery still explains itself later.
5. Discography conversations reachable and deletable outside the artist page.
6. Account-data export, and the documentation the compliance plan requires.
7. Verifying deleted records are gone from every normal API path.

## Deferred

- **Sharing or public library pages.** No sharing surface exists and none is
  planned before the private pilot.
- **Cross-device sync beyond what Postgres already gives.** There is no offline
  store to reconcile.
- **Editing a generated playlist after creation.** It lives in the listener's
  Spotify account; this product records that it made it, and does not manage it.
- **Re-running a past discovery from history.** Retrieval and ranking have
  changed between phases, so "the same search" would not give the same result,
  and presenting it as a replay would be a claim the product cannot honour.

## Boundary interaction

Unchanged in shape. The library stores application-owned records and MusicBrainz
identifiers. Spotify appears only as an already-created playlist id and its URL
— the "operationally required" exception recorded in Phase 7 — and never as
mirrored catalogue metadata. Nothing in `features/library/**` will import an AI
module or a Spotify provider module, and both directions get lint rules and a
compliance scan assertion, as Phase 8 did.

Export is the one new risk: an export file is the first artefact that leaves the
system carrying several tables at once. It must contain application-owned data
and provider identifiers, not a re-hosted copy of anyone's catalogue.

## Risks

- **A history that starts empty.** Whatever is decided in question 3, most
  accounts will have little history on day one, and the empty state has to say
  why without implying something was lost.
- **Undo and privacy pull in opposite directions.** The compliance requirement
  is that deleted records are not reachable through normal APIs; undo wants the
  row to survive a little longer. Question 2.
- **Export is a data-egress surface.** It is the one feature here that could
  leak more than intended, and it deserves its own review rather than being
  treated as a serialisation task.
- **Bulk delete is irreversible at scale.** A confirmation that a listener
  clicks through is not a control; the interaction needs to state the count.

## Open questions

1. ~~**Tag storage.**~~ **Closed 2026-08-07.** A `text[]` column on
   `favorite_discoveries`, folded into the same migration decision 4 requires,
   with a GIN index so tag filtering stays fast.

   The reasoning below overstated the array's limits and is corrected here.
   Renaming across a library is `array_replace` in one statement, and a per-user
   tag vocabulary for autocomplete is `distinct unnest(tags)`. Neither needs a
   join table. What the array genuinely costs is element-level validation:
   Postgres CHECK constraints cannot contain subqueries, so "each tag is 1-40
   characters" cannot be a constraint and needs a `before insert or update`
   trigger. That trigger trims, lowercases, drops empties, deduplicates and caps
   the count at 20, which makes case variants the same tag at the database level
   rather than at every call site.

   Filtering is AND across selected tags, not OR: on a small library OR returns
   nearly everything and reads as broken. "No favourites yet" and "no favourites
   match these tags" are distinct empty states, because they need different
   actions from the listener.

   Reversed only if tags ever need attributes of their own — a colour, a
   description, an ordering. None is foreseen. Retained below for the reasoning.

   `favorite_discoveries` has no tags column. A `text[]` column
   is one migration, needs no join, and keeps reads simple — but tags cannot be
   renamed or merged across a library, and there is no per-user tag vocabulary
   to offer as suggestions. A separate `favorite_tags` table gives both, at the
   cost of a join on every library read and more RLS surface to test. My
   recommendation: the array column, because renaming tags is a feature nobody
   has asked for and the join cost is paid on the most-viewed page in the app.

2. ~~**Undo removal.**~~ **Closed 2026-08-07.** Genuine delete, with the removed
   record held in browser state for roughly ten seconds or until navigation, so
   undo re-inserts it. Nothing survives server-side that a query could reach.
   A restored record gets a new id and `created_at`, and the interface says it
   was re-added rather than pretending it was never removed. Bulk delete states
   the exact count and offers no undo — an undo that usually fails is worse than
   none. A residual-data assertion joins the pgTAP suite as a standing guard
   against a soft-delete regression: after a delete the row is absent from the
   table, not merely filtered out of a view. Retained below for the reasoning.

   The master prompt requires that deleted records not remain
   accessible through normal APIs, which rules out a `deleted_at` column that
   ordinary queries filter out — that is exactly "still there, just hidden". The
   alternative is a genuine delete with the removed row held in memory in the
   browser for a short window, so undo re-inserts it. That is honest but loses
   the undo if the tab closes, and the re-inserted row gets a new id and
   `created_at`. My recommendation: genuine delete with an in-memory undo
   window, and the interface saying plainly that leaving the page finalises it.

3. ~~**What history records, and from when.**~~ **Closed 2026-08-07.** History
   covers discovery, mood, and discography questions — `input_kind` widens to
   include `discography`. Recording begins at Phase 9's ship date and runs
   forward only. **No entries are synthesised for past activity under any
   framing.** For accounts that predate tracking, the empty state says plainly
   that history began when the feature did, rather than implying nothing
   happened. Retained below for the reasoning.

   Nothing writes sessions today, so
   there is a choice about scope and about the past:
   - *Scope:* `discovery_sessions.input_kind` is constrained to `('artist',
     'mood')`, so Phase 8 discography questions are not representable without
     widening it. Should history cover discovery, mood, and discography
     questions — or only the first two, leaving conversations to the library?
   - *The past:* existing accounts have playlists, favourites and conversations
     but no sessions. Start recording from Phase 9 forward and let history
     begin empty, or synthesise entries from the rows that do exist? Synthesis
     would put plausible timestamps on events that were never recorded, which I
     would not do quietly.
   My recommendation: widen `input_kind` to include `discography`, record from
   Phase 9 forward only, and have the empty state say history began when the
   feature did rather than implying nothing happened.

4. ~~**Saved explanations.**~~ **Closed 2026-08-07.** Both, deliberately.
   `discovery_results` records what a run produced, for history. A separate
   snapshot is copied onto `favorite_discoveries` at save time: a versioned
   `jsonb` holding `summary`, `sharedCharacteristics`, `contrast` and
   `startingPoint`, plus `source`, `model` and provider as plain columns.

   Normalising the two would couple them, and `discovery_results` cascades from
   `discovery_sessions`, so clearing history would silently strip every saved
   favourite of the explanation that caused it to be saved. Duplication is the
   point: the two records answer different questions and must have independent
   lifetimes.

   `groundedIn` is dropped. It is the verification trace, its job finished when
   the explanation passed its citation check before first display, and keeping
   it would invite a later reader to re-verify against evidence that no longer
   exists. The interface dates a stored explanation as a snapshot rather than
   presenting it as current. Retained below for the reasoning.

   `discovery_results.rationale` exists and is unused.
   Persisting a Phase 6 explanation means storing model output verbatim with the
   provider and model that produced it, so a saved discovery still explains
   itself months later. Not persisting means regenerating on view — which spends
   an AI request per view, counts against the 20/day cap, and can produce a
   different explanation than the one that convinced the listener to save it.
   My recommendation: persist at save time. A library that shows a different
   reason than the one you kept is worse than one that shows an old reason, and
   the daily cap makes regeneration genuinely user-visible.

5. ~~**Where discography conversations live.**~~ **Closed 2026-08-07.** History,
   at one session row per conversation rather than per question. `updated_at`
   tracks growth, `completed_at` is set on the first successful answer, and the
   entry states how many questions it covers so a title drawn from the opening
   question does not read as the whole of it.

   The line: the library is for things deliberately kept, history is for what
   happened. A conversation is the latter. Keeping an individual answer is
   already representable — `favorite_discoveries.source_type` accepts
   `discography` — so nothing new is needed for that path.

   Content stays where it is; the entry links to the artist page, which already
   renders the conversation. Deleting an entry cascades to messages through the
   owner-scoped foreign key Phase 2 defined, and the conversation is resolved by
   `(user_id, canonical_artist_id)` rather than by adding a column to a Phase 8
   table. This closes the retention tripwire Phase 8 left open.

   Decision 3 made this cheaper than expected: because history covers all three
   activity types through `discovery_sessions`, there is one spine table to
   paginate rather than a union of differently-shaped rows. Retained below for
   the reasoning.

   They are the only Phase 8 records
   with no home outside the artist page. Options: a library entity type
   alongside favourites; a history entity; or settings-only bulk deletion with
   no browsing. This also settles the retention tripwire left open in Phase 8.
   My recommendation: history, with per-conversation delete. They are a record
   of what was asked, which is what history is; the library is for things
   deliberately kept.

6. ~~**Export scope and format.**~~ **Closed 2026-08-07.** Documentation only for
   the user-facing mechanism: operator-run, on request, JSON out. The
   documentation describes that process honestly and contains no "export from
   settings" language, because no such control exists. The download, route and
   interface defer to Phase 12 alongside the privacy-policy draft.

   The enumeration ships now: a server-side function with no route and no HTTP
   surface, listing every user-owned table and returning one listener's rows.
   Two tests give it its value — it must cover every table carrying a `user_id`
   column, so a table added later fails the test until it is registered, and it
   must return nothing after account deletion. The second is the T23
   residual-data check the threat model already commits to, and it composes with
   decision 2's assertion. Retained below for the reasoning.

   The compliance plan requires account-data export
   *documentation*; whether Phase 9 ships the mechanism is a scope decision.
   Options: a documented manual process; a JSON download of every
   application-owned row; or JSON plus a human-readable summary. Cost rises with
   each, and the JSON download is the first feature that emits a
   multi-table artefact. My recommendation: ship the JSON download in Phase 9,
   because a data right that requires asking someone is one most people never
   exercise — but this is a scope decision and it is yours.

7. **Pagination shape.** Cursor-based on `created_at` is stable while rows are
   being deleted and is what large libraries want; offset pagination is simpler
   and works with a page-number control. Given bulk delete is in scope, offset
   pagination will visibly skip rows mid-session. My recommendation: cursor.
