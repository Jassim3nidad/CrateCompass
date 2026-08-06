# Phase 8 — Discography explorer and Q&A: scoping

Status: proposed, not started — awaiting decisions on the open questions  
Date: 2026-08-06  
Builds on: [phase-6-discovery.md](phase-6-discovery.md),
[phase-7-scope.md](phase-7-scope.md),
[provider-boundaries.md](../architecture/provider-boundaries.md)

## What Phase 8 promises

A listener browses an artist's releases and asks factual questions about them,
and every answer is grounded in retrieved MusicBrainz records with sources they
can check. An unanswerable question is answered with "the data does not say"
rather than a plausible sentence.

## A defect to fix first

`lookupArtist` requests `inc=release-groups`, and MusicBrainz caps that
subquery at **25 release groups**. It does not say it has done so.

Measured on 2026-08-06:

| Artist | Groups from `inc=release-groups` | Actual total via browse |
| --- | --- | --- |
| Portishead | 25 | 25 |
| Nirvana | 25 | **573** |

Two consequences, both live in shipped code:

1. The Phase 6 artist header states "MusicBrainz records 25 release groups for
   this artist". For Nirvana that sentence is false, and it is exactly the
   failure mode the Phase 8 brief names — *presenting incomplete MusicBrainz
   data as complete*.
2. Phase 7 track selection picks studio albums from those 25. For a prolific
   artist the real studio albums may not be among them.

Of Nirvana's first 100 release groups, **3 are plain studio albums** and 52 are
compilations. Any question of the form "how many studio albums" answered from a
partial fetch is wrong, not approximate.

**Fixing this is the first task of Phase 8, not a follow-up.** The browse
endpoint (`/ws/2/release-group?artist=…&limit=100`) reports a total count and
pages at 100, so a complete discography is 1–6 paced requests.

## What already exists

Phase 8 is unusually well supplied by earlier phases:

| Piece | State |
| --- | --- |
| `answerDiscographyQuestion` on the AI port | Built and contract-tested across all four adapters |
| `discographyAnswerSchema` with `sufficientContext` and `citedReleaseIds` | Built; "not enough context" is already a first-class success |
| `answerDiscographyQuestionInputSchema` (strict, ≤200 releases) | Built |
| `discography_conversations` / `discography_messages` tables with RLS | Created in Phase 2, still unused; `ai_provider` widened for Gemini in Phase 6 |
| Release-type and partial-date normalisation | Built (`parsePartialDate`, `DiscographyRelease`) |
| Grounding-verification pattern | Built for explanations in Phase 6; the same shape applies to cited releases |
| Fixture AI provider with a discography answer | Built in the Phase 7 gap closure |

The genuinely new work is retrieval at full size, context selection, the
conversation surface, and citation verification.

## Boundary interaction

Unchanged in shape from Phases 6 and 7:

- `lib/discography/**` and `features/discography/**` join the rule forbidding
  Spotify provider imports.
- The AI receives the listener's question plus normalised MusicBrainz release
  records. Never a Spotify value, never a track from a resolved playlist.
- Open-in-Spotify on this page resolves separately, on demand, exactly as the
  Phase 6 artist page does.

### One new risk: injection through community-edited metadata

Release titles and disambiguation comments are edited by the public. A release
group could be titled `Ignore previous instructions and…`, and that string
travels to the model as retrieved context.

The existing gateway does not address this — it checks *provenance and
forbidden content*, not instruction-shaped text. Phase 8 needs the answer
verified against supplied identifiers regardless of what the prose says, which
is the same defence Phase 6 uses: a fabricated or manipulated answer fails the
citation check and is discarded. Whether to also neutralise the text on the way
in is open question 4.

## In scope

1. Complete release-group retrieval with pagination, an accurate total, and an
   explicit "showing N of M" when a bound is hit.
2. Release timeline: chronological ordering, partial-date precision preserved,
   filters for album, EP, single, live, compilation, soundtrack, and other.
3. Release detail with source links to MusicBrainz.
4. Q&A panel with conversation history persisted per user.
5. Bounded, deterministic context selection with the criteria stated in the UI.
6. Citation verification: every `citedReleaseIds` entry must be a release that
   was actually supplied, or the answer is discarded and the deterministic
   "insufficient context" response is shown instead.
7. Suggested factual questions, and an explicit missing-data notice.
8. Fixing the 25-release-group cap, including the Phase 6 header sentence and
   Phase 7 track selection that depend on it.

## Deferred

- **Track-level questions** ("what is track 3 on…"). Track listing costs one
  paced request per release group; answering across a discography is not
  affordable at MusicBrainz's rate limit.
- **Cross-artist questions** ("who did they tour with"). Relationship data is a
  different retrieval shape and a much larger surface.
- **Editorial or interpretive questions** ("what is their best album"). Refused
  by design, not by omission — the product answers from records.
- **Conversation export and deletion controls.** Phase 9 owns retention.

## Rough module plan

```
lib/discography/
  retrieval.ts      pagination, completeness accounting (pure where possible)
  selection.ts      question -> bounded release context (pure)
  verification.ts   citation checking, same shape as Phase 6 explanation checks
lib/providers/musicbrainz/
  client.ts         + browseReleaseGroups with paging and total count
features/discography/
  service.ts        retrieve -> select -> answer -> verify
  actions.ts        askQuestion, loadTimeline
  repository.ts     conversations and messages
  components/       timeline, filters, release detail, Q&A panel, history
app/artists/[artistId]/
  page.tsx          replace the Phase 8 placeholder card with the explorer
```

## Risks

- **Retrieval cost.** A 573-group artist is 6 paced requests before a single
  question is answered. Caching helps repeat visits, not the first one.
- **Context selection is where correctness is won or lost.** Filtering too
  aggressively drops the release that held the answer; filtering too little
  overruns the 200-release schema bound on a prolific artist.
- **The usage limiter fights conversation.** 4 requests per user per minute and
  20 per day is sensible for one-off explanations and hostile to a Q&A panel,
  where three follow-up questions is normal. See open question 2.
- **Community metadata is adversarial input.** Covered by citation
  verification, but the honest position is defence in depth, not one check.

## Open questions

1. **Retrieval bound.** Fetch every release group (6 paced requests for the
   worst realistic case), or cap at 300 with "showing 300 of 573" stated
   plainly? A cap keeps the page fast but makes counting questions unanswerable
   — which the UI would then have to say. My recommendation: fetch all, cache
   for six hours, and show a progress state, because the counting questions are
   the ones people actually ask.
2. **Usage limits for Q&A.** Current limits make a conversation stop after four
   questions in a minute or twenty in a day. Options: raise the per-minute
   allowance for this operation only; keep the limits and show remaining quota
   in the panel; or count a conversation rather than a question. This is a cost
   decision, so it is yours.
3. **Conversation retention default.** The tables persist indefinitely and
   Phase 9 owns deletion controls. Keep every conversation until then, or keep
   only the most recent per artist and let Phase 9 introduce history?
4. **Injection handling depth.** Citation verification catches a manipulated
   *answer*. Should retrieved titles and disambiguations also be neutralised on
   the way in — delimited and escaped, with instruction-shaped strings flagged
   — or is post-answer verification sufficient for a private pilot?
