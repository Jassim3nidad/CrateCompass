# Phase 8 — Discography explorer and Q&A: scoping

Status: decisions closed 2026-08-06; implementation awaiting approval of
[phase-8-plan.md](phase-8-plan.md)  
Date: 2026-08-06  
Builds on: [phase-6-discovery.md](phase-6-discovery.md),
[phase-7-scope.md](phase-7-scope.md),
[provider-boundaries.md](../architecture/provider-boundaries.md)

## What Phase 8 promises

A listener browses an artist's releases and asks factual questions about them,
and every answer is grounded in retrieved MusicBrainz records with sources they
can check. An unanswerable question is answered with "the data does not say"
rather than a plausible sentence.

## A defect that was fixed first — resolved in `330faea`

**Resolved before Phase 8 began.** The retrieval mechanism, both consumers, and
contract coverage all landed in `330faea`; what follows is the record of why.
Only the *display* question survived into Phase 8, and it is settled in
decision 1 below.

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

## Decisions — all closed 2026-08-06

### 1. Retrieval bound: fetch everything

Every release group is retrieved, cached for six hours, and a staged progress
state covers the wait. The counting questions — "how many studio albums", "which
came out in the 2010s" — are the ones people actually ask, and a bounded slice
makes them unanswerable rather than cheaper.

Cost accepted: roughly six paced seconds on a cold cache for a 573-group artist.
The 10-page safety bound stays for catalogue placeholders like "Various Artists"
(288,991 groups, ~45 minutes at one request per second). When it engages,
`releasesComplete` is false, the interface marks the retrieval partial, and Q&A
declines counting questions rather than answering from a slice.

### 2. Q&A usage limits: wider burst, same daily ceiling

`answerDiscographyQuestion` allows ten requests a minute; the daily cap stays at
twenty. Maximum spend per user is unchanged — the burst window exists to stop
runaway loops, and a conversation is not one.

**Already implemented** in `5a0536d`: no migration was required, because
`claim_ai_usage` takes both windows as call arguments. See `perMinuteLimitFor`
in `lib/ai/limits.ts`.

Known consequence: the window is counted across all operations, so ten rapid
questions will then block a mood parse, which still allows four. The window is
shared; the operation states the tolerance it accepts.

The remaining-quota display is part of the Phase 8 build and does need a
migration — see the plan.

### 3. Conversation retention: keep everything

No TTL, no cap, no purge job. Phase 9 owns deletion controls and should build
them on complete data. Keeping only the most recent conversation per artist was
rejected because it destroys history silently.

A tripwire is recorded in the roadmap: this default is sized for a five-user
pilot, growth is unbounded, and it must be revisited if the pilot widens or
Phase 9 slips.

### 4. Injection handling: delimit blocking, detect logged-only

Three layers, deliberately split by how reliable each one is:

1. **Structural delimiting — blocking.** Retrieved records reach the model
   inside an explicit escaped data envelope, framed as records rather than
   instructions. Deterministic, and it removes the ambiguity rather than
   guessing at intent.
2. **Instruction-shaped detection — logged only, never blocking.** "Instruction
   shaped" is not reliably detectable and MusicBrainz holds real releases whose
   titles are imperative sentences. A blocking heuristic would corrupt genuine
   discography entries on exactly the most interesting catalogues. Logging gives
   the signal without the collateral damage, and produces the evidence needed to
   justify anything stronger.
3. **Citation verification — unchanged.** Every `citedReleaseIds` entry must be
   a release actually supplied, or the answer is discarded.

Displayed titles are never altered. Neutralisation applies only to what reaches
the model; changing what is shown would misrepresent the source.

Why input work is still needed given verification: citation checking cannot see
an injected string steering the model into refusing a legitimate question, nor a
correctly-cited but wrongly-described answer. Both are failures the
anti-hallucination rules exist to prevent.
